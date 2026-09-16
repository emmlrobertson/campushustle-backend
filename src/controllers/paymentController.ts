import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { PaymentMethod, PaymentStatus, EscrowStatus, OrderStatus, SubOrderStatus } from '@prisma/client';

const getPaystackSecretKey = () => (process.env.PAYSTACK_SECRET_KEY || '').trim();

function parsePaymentMethod(method?: string): PaymentMethod {
  if (!method) return PaymentMethod.MTN_MOMO;
  const upper = method.toUpperCase().replace(/\s+/g, '_');
  if (upper.includes('TELECEL') || upper.includes('VODAFONE')) return PaymentMethod.TELECEL_CASH;
  if (upper.includes('AIRTEL') || upper.includes('TIGO')) return PaymentMethod.AIRTEL_TIGO_MONEY;
  if (upper.includes('CARD')) return PaymentMethod.CARD;
  return PaymentMethod.MTN_MOMO;
}

/**
 * Initialize Mobile Money Payment with Campus Escrow Protection
 * POST /api/payments/initialize (Requires JWT Authentication)
 */
export const initializePayment = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const buyerId = authReq.user?.id;

    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required to initiate payment.' });
    }

    const { hustleId, momoNumber, paymentMethod, meetupSpot = 'CCB Ground Floor' } = req.body;

    if (!hustleId || !momoNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: hustleId, momoNumber.',
      });
    }

    // 1. Fetch authenticated buyer profile
    const buyer = await prisma.user.findUnique({
      where: { id: buyerId },
      include: { university: true },
    });

    if (!buyer || !buyer.isActive) {
      return res.status(401).json({ success: false, error: 'Student account not found or deactivated.' });
    }

    if (!buyer.phoneVerified) {
      return res.status(403).json({
        success: false,
        error: 'Please verify your Ghanaian phone number via SMS OTP before making payments.',
      });
    }

    // 2. Fetch Hustle and verify seller
    const hustle = await prisma.hustle.findUnique({
      where: { id: hustleId },
      include: {
        sellerProfile: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phoneNumber: true },
            },
          },
        },
        university: true,
      },
    });

    if (!hustle || hustle.status !== 'ACTIVE') {
      return res.status(404).json({
        success: false,
        error: 'Hustle listing is not available for purchase.',
      });
    }

    // 3. Prevent self-purchase
    if (hustle.sellerProfile && hustle.sellerProfile.userId === buyer.id) {
      return res.status(400).json({
        success: false,
        error: 'You cannot purchase your own hustle listing.',
      });
    }

    const cleanMomoNumber = String(momoNumber || '').trim();
    const cleanMeetupSpot = String(meetupSpot || 'Campus Spot').trim();
    const sellerName =
      hustle.sellerProfile?.businessName ||
      hustle.sellerProfile?.user?.name ||
      'Campus Hustle Seller';

    const uniCode = buyer.university?.code || 'KNUST';
    const orderNumber = `CH-${uniCode}-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const subOrderNumber = `${orderNumber}-A`;
    const reference = `PAY_${uniCode}_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const methodEnum = parsePaymentMethod(paymentMethod);

    // 4. Create Order, SubOrder, and Payment in a transaction
    const { order, payment } = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          buyerId: buyer.id,
          totalAmount: hustle.price,
          currency: 'GHS',
          status: OrderStatus.PENDING_PAYMENT,
        },
      });

      await tx.subOrder.create({
        data: {
          subOrderNumber,
          orderId: newOrder.id,
          sellerProfileId: hustle.sellerProfileId,
          subtotal: hustle.price,
          meetupLocation: cleanMeetupSpot,
          status: SubOrderStatus.PENDING_ACCEPTANCE,
          escrowStatus: EscrowStatus.HELD,
          items: {
            create: {
              hustleId: hustle.id,
              snapshotTitle: hustle.title,
              snapshotPrice: hustle.price,
              quantity: 1,
              lineTotal: hustle.price,
            },
          },
        },
      });

      const newPayment = await tx.payment.create({
        data: {
          orderId: newOrder.id,
          reference,
          amount: hustle.price,
          currency: 'GHS',
          paymentMethod: methodEnum,
          momoNumber: cleanMomoNumber,
          status: PaymentStatus.INITIALIZED,
        },
      });

      return { order: newOrder, payment: newPayment };
    });

    let authorizationUrl = `https://checkout.paystack.com/simulate_${reference}`;

    const paystackSecretKey = getPaystackSecretKey();
    if (paystackSecretKey) {
      try {
        const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: Math.round(Number(hustle.price) * 100), // Pesewas
            email: buyer.email,
            reference,
            currency: 'GHS',
            channels: ['mobile_money', 'card'],
            metadata: {
              orderId: order.id,
              hustleId: hustle.id,
              sellerName,
              momoNumber: cleanMomoNumber,
              meetupSpot: cleanMeetupSpot,
            },
          }),
        });

        const paystackData = (await paystackRes.json()) as any;
        if (paystackData.status && paystackData.data?.authorization_url) {
          authorizationUrl = paystackData.data.authorization_url;
        }
      } catch (paystackErr) {
        console.warn('Paystack API call notice:', paystackErr);
      }
    }

    res.status(201).json({
      success: true,
      message: '💳 Mobile Money Payment Initialized with Campus Escrow Protection!',
      data: {
        reference: payment.reference,
        orderNumber: order.orderNumber,
        amount: Number(hustle.price),
        currency: 'GHS',
        recipientSeller: sellerName,
        momoNumber: payment.momoNumber,
        provider: methodEnum,
        authorizationUrl,
        escrowStatus: 'HELD',
        meetupSpot: cleanMeetupSpot,
        instructions: `A Mobile Money prompt of GH₵ ${Number(hustle.price).toFixed(2)} has been initiated for ${cleanMomoNumber}. Your funds remain safely held in Campus Escrow until service is delivered at ${cleanMeetupSpot}.`,
      },
    });
  } catch (error: any) {
    console.error('initializePayment error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error initializing payment.',
    });
  }
};

/**
 * Verify Mobile Money Payment
 * GET /api/payments/verify/:reference
 */
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { reference } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { reference },
      include: {
        order: {
          include: {
            buyer: { select: { id: true, name: true, email: true } },
            subOrders: {
              include: {
                sellerProfile: {
                  include: {
                    user: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment transaction reference not found.' });
    }

    if (payment.status === PaymentStatus.SUCCESS) {
      return res.json({
        success: true,
        message: '🎉 Payment Verified Successfully!',
        transaction: {
          reference: payment.reference,
          orderNumber: payment.order.orderNumber,
          amount: Number(payment.amount),
          currency: payment.currency,
          buyerEmail: payment.order.buyer.email,
          status: 'success',
          escrowStatus: 'HELD',
          paidAt: payment.paidAt,
        },
      });
    }

    let isSuccess = false;

    const paystackSecretKey = getPaystackSecretKey();
    if (paystackSecretKey) {
      try {
        const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
          headers: { Authorization: `Bearer ${paystackSecretKey}` },
        });
        const paystackData = (await paystackRes.json()) as any;
        if (paystackData.data?.status === 'success') {
          isSuccess = true;
        }
      } catch (e) {
        console.warn('Paystack verify error:', e);
      }
    } else {
      // Non-production development testing simulation only if DEV_PAYMENT_SIMULATION is explicitly enabled
      if (process.env.NODE_ENV !== 'production' && process.env.DEV_PAYMENT_SIMULATION === 'true') {
        isSuccess = true;
      } else {
        return res.status(400).json({
          success: false,
          error: 'Payment verification gateway not configured. Please configure PAYSTACK_SECRET_KEY.',
        });
      }
    }

    if (isSuccess) {
      await prisma.$transaction([
        prisma.payment.update({
          where: { reference },
          data: {
            status: PaymentStatus.SUCCESS,
            paidAt: new Date(),
          },
        }),
        prisma.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.PAID },
        }),
        prisma.subOrder.updateMany({
          where: { orderId: payment.orderId },
          data: {
            status: SubOrderStatus.IN_PROGRESS,
            escrowStatus: EscrowStatus.HELD,
          },
        }),
      ]);

      return res.json({
        success: true,
        message: '🎉 Payment Verified Successfully!',
        transaction: {
          reference: payment.reference,
          orderNumber: payment.order.orderNumber,
          amount: Number(payment.amount),
          currency: payment.currency,
          buyerEmail: payment.order.buyer.email,
          status: 'success',
          escrowStatus: 'HELD',
          completedAt: new Date().toISOString(),
        },
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Payment has not been completed or was not confirmed by mobile money provider.',
    });
  } catch (error: any) {
    console.error('verifyPayment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error verifying payment.' });
  }
};

/**
 * Release Escrow Funds to Seller (Buyer confirmation)
 * POST /api/payments/release/:reference (Requires JWT Authentication)
 */
export const releaseEscrow = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const buyerId = authReq.user?.id;
    const { reference } = req.params;

    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required to release escrow.' });
    }

    const payment = await prisma.payment.findUnique({
      where: { reference },
      include: {
        order: {
          include: {
            subOrders: true,
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Transaction reference not found.' });
    }

    // Ownership check: only the paying student buyer can release escrow
    if (payment.order.buyerId !== buyerId) {
      return res.status(403).json({
        success: false,
        error: 'Only the student buyer who placed this order can release escrow funds.',
      });
    }

    if (payment.status !== PaymentStatus.SUCCESS) {
      return res.status(400).json({
        success: false,
        error: 'Escrow cannot be released on an unpaid transaction.',
      });
    }

    // Update all subOrders under this order to RELEASED_TO_SELLER and COMPLETED
    await prisma.$transaction(async (tx) => {
      for (const subOrder of payment.order.subOrders) {
        if (subOrder.escrowStatus === EscrowStatus.RELEASED_TO_SELLER) continue;

        await tx.subOrder.update({
          where: { id: subOrder.id },
          data: {
            escrowStatus: EscrowStatus.RELEASED_TO_SELLER,
            status: SubOrderStatus.COMPLETED,
            completedAt: new Date(),
          },
        });

        // Increment seller total sales count
        await tx.sellerProfile.update({
          where: { id: subOrder.sellerProfileId },
          data: { totalSalesCount: { increment: 1 } },
        });
      }

      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.COMPLETED },
      });
    });

    res.json({
      success: true,
      message: '🛡️ Escrow released! Funds disbursed to seller.',
      reference,
      escrowStatus: 'RELEASED_TO_SELLER',
    });
  } catch (error: any) {
    console.error('releaseEscrow error:', error);
    res.status(500).json({ success: false, error: 'Internal server error releasing escrow.' });
  }
};

/**
 * Get Transaction & Order History for Authenticated Student Buyer
 * GET /api/payments/history (Requires JWT Authentication)
 */
export const getTransactionHistory = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const buyerId = authReq.user?.id;

    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required to view payment history.' });
    }

    const orders = await prisma.order.findMany({
      where: { buyerId },
      include: {
        payments: true,
        subOrders: {
          include: {
            items: true,
            sellerProfile: {
              include: {
                user: { select: { id: true, name: true, avatarUrl: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedHistory = orders.map((order) => {
      const primaryPayment = order.payments[0];
      const primarySubOrder = order.subOrders[0];
      const primaryItem = primarySubOrder?.items[0];

      const sellerName =
        primarySubOrder?.sellerProfile?.businessName ||
        primarySubOrder?.sellerProfile?.user?.name ||
        'Student Hustler';
      const escrowStatus = primarySubOrder?.escrowStatus || 'HELD';
      const meetupSpot = primarySubOrder?.meetupLocation || 'Campus Spot';
      const createdAt = order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt;

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        order_number: order.orderNumber,
        reference: primaryPayment?.reference || 'N/A',
        hustleTitle: primaryItem?.snapshotTitle || 'Campus Hustle Service',
        hustle_title: primaryItem?.snapshotTitle || 'Campus Hustle Service',
        sellerName,
        seller_name: sellerName,
        amount: Number(order.totalAmount),
        currency: order.currency,
        status: order.status,
        paymentStatus: primaryPayment?.status || 'PENDING',
        payment_status: primaryPayment?.status || 'PENDING',
        escrowStatus,
        escrow_status:
          escrowStatus === 'RELEASED_TO_SELLER'
            ? 'released'
            : escrowStatus === 'REFUNDED_TO_BUYER'
            ? 'refunded'
            : 'held',
        meetupSpot,
        meetup_spot: meetupSpot,
        createdAt,
        created_at: createdAt,
      };
    });

    res.json({
      success: true,
      count: formattedHistory.length,
      data: formattedHistory,
    });
  } catch (error: any) {
    console.error('getTransactionHistory error:', error);
    res.status(500).json({ success: false, error: 'Internal server error fetching history.' });
  }
};

/**
 * Paystack Webhook Handler (Asynchronous payment confirmation)
 * POST /api/payments/webhook
 * Requirements:
 * - No JWT authentication
 * - Verify x-paystack-signature using HMAC SHA512 of rawBody
 * - Idempotently handle charge.success
 */
export const handlePaystackWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-paystack-signature'] as string;
    const secret = getPaystackSecretKey();

    if (!signature || !secret) {
      return res.status(400).json({ success: false, error: 'Webhook signature or secret missing' });
    }

    // Compute HMAC SHA512 on raw body buffer or JSON string
    const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
    const expectedSignature = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({ success: false, error: 'Invalid Paystack webhook signature' });
    }

    const event = req.body;

    if (event.event === 'charge.success') {
      const data = event.data;
      const reference = data?.reference;

      if (!reference) {
        return res.status(400).json({ success: false, error: 'Missing reference in event data' });
      }

      // 1. Locate payment record
      const payment = await prisma.payment.findUnique({
        where: { reference },
        include: { order: true },
      });

      if (!payment) {
        console.warn(`Paystack webhook: transaction reference '${reference}' not found in database.`);
        return res.status(200).json({ status: 'ignored', reason: 'Reference not found' });
      }

      // 2. Idempotency: if already marked SUCCESS, acknowledge immediately
      if (payment.status === PaymentStatus.SUCCESS) {
        return res.status(200).json({ status: 'already_processed' });
      }

      // 3. Atomically update payment, order, and sub-orders
      await prisma.$transaction([
        prisma.payment.update({
          where: { reference },
          data: {
            status: PaymentStatus.SUCCESS,
            paidAt: new Date(data.paid_at || Date.now()),
            rawMetadata: data,
          },
        }),
        prisma.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.PAID },
        }),
        prisma.subOrder.updateMany({
          where: { orderId: payment.orderId },
          data: {
            status: SubOrderStatus.IN_PROGRESS,
            escrowStatus: EscrowStatus.HELD,
          },
        }),
      ]);

      console.log(`✅ Paystack Webhook: Order '${payment.order.orderNumber}' marked PAID via reference '${reference}'`);
    }

    // Acknowledge receipt to Paystack
    res.status(200).json({ status: 'success' });
  } catch (error: any) {
    console.error('Paystack webhook processing error:', error);
    res.status(500).json({ success: false, error: 'Internal server error processing webhook' });
  }
};
