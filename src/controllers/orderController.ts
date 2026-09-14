import { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import {
  checkoutOrderSchema,
  updateSubOrderStatusSchema,
  cancelSubOrderSchema,
  disputeSubOrderSchema,
} from '../validators/orderValidators';
import { OrderStatus, SubOrderStatus, EscrowStatus } from '@prisma/client';
import crypto from 'crypto';

// Helper: Generate order numbers like CH-KNUST-20260914-A82F
function generateOrderNumber(campusCode: string): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  const campus = (campusCode || 'CAMPUS').toUpperCase();
  return `CH-${campus}-${dateStr}-${rand}`;
}

// Format SubOrder response
function formatSubOrderResponse(subOrder: any) {
  return {
    id: subOrder.id,
    subOrderNumber: subOrder.subOrderNumber,
    orderId: subOrder.orderId,
    sellerProfileId: subOrder.sellerProfileId,
    sellerName: subOrder.sellerProfile?.businessName || subOrder.sellerProfile?.user?.name || 'Seller',
    sellerPhone: subOrder.sellerProfile?.payoutMomoNumber || subOrder.sellerProfile?.user?.phoneNumber || '',
    status: subOrder.status,
    escrowStatus: subOrder.escrowStatus,
    subtotal: Number(subOrder.subtotal),
    meetupLocation: subOrder.meetupLocation,
    deliveryAddress: subOrder.deliveryAddress,
    notesToSeller: subOrder.notesToSeller,
    acceptedAt: subOrder.acceptedAt ? subOrder.acceptedAt.toISOString() : null,
    deliveredAt: subOrder.deliveredAt ? subOrder.deliveredAt.toISOString() : null,
    completedAt: subOrder.completedAt ? subOrder.completedAt.toISOString() : null,
    cancelledAt: subOrder.cancelledAt ? subOrder.cancelledAt.toISOString() : null,
    cancellationReason: subOrder.cancellationReason,
    createdAt: subOrder.createdAt ? subOrder.createdAt.toISOString() : null,
    items: subOrder.items ? subOrder.items.map((item: any) => ({
      id: item.id,
      hustleId: item.hustleId,
      title: item.snapshotTitle,
      price: Number(item.snapshotPrice),
      quantity: item.quantity,
      lineTotal: Number(item.lineTotal),
    })) : [],
  };
}

// Format Parent Order response
function formatOrderResponse(order: any) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    buyerId: order.buyerId,
    buyerName: order.buyer?.name,
    buyerEmail: order.buyer?.email,
    totalAmount: Number(order.totalAmount),
    currency: order.currency,
    status: order.status,
    campusCode: order.campusCode,
    contactPhone: order.contactPhone,
    idempotencyKey: order.idempotencyKey,
    createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
    subOrders: order.subOrders ? order.subOrders.map(formatSubOrderResponse) : [],
  };
}

// ============================================================================
// 1. CHECKOUT ORDER (Multi-Seller, Server-Side Pricing, Inventory & Atomic Transaction)
// ============================================================================
export const checkoutOrder = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const buyerId = authReq.user?.id;

    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required to checkout' });
    }

    // 1. Validate request body
    const validation = checkoutOrderSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order request',
        details: validation.error.flatten(),
      });
    }

    const { items: requestItems, contactPhone, idempotencyKey: bodyIdempotencyKey } = validation.data;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || bodyIdempotencyKey;

    // 2. Check Idempotency (Prevent double-submit)
    if (idempotencyKey) {
      const existingOrder = await prisma.order.findUnique({
        where: { idempotencyKey },
        include: {
          buyer: true,
          subOrders: {
            include: {
              sellerProfile: { include: { user: true } },
              items: true,
            },
          },
        },
      });

      if (existingOrder) {
        return res.status(200).json({
          success: true,
          message: 'Order retrieved from existing idempotency session',
          data: formatOrderResponse(existingOrder),
        });
      }
    }

    // 3. Fetch buyer details
    const buyer = await prisma.user.findUnique({
      where: { id: buyerId },
      include: { university: true },
    });

    if (!buyer) {
      return res.status(401).json({ success: false, error: 'Student buyer account not found' });
    }

    // 4. Fetch all referenced Hustles in one query
    const hustleIds = Array.from(new Set(requestItems.map((item) => item.hustleId)));
    const hustles = await prisma.hustle.findMany({
      where: { id: { in: hustleIds } },
      include: {
        sellerProfile: { include: { user: true } },
        university: true,
      },
    });

    const hustleMap = new Map<string, typeof hustles[0]>();
    for (const h of hustles) {
      hustleMap.set(h.id, h);
    }

    // 5. Security & Availability Validations
    for (const reqItem of requestItems) {
      const hustle = hustleMap.get(reqItem.hustleId);

      if (!hustle) {
        return res.status(404).json({
          success: false,
          error: `Listing '${reqItem.hustleId}' was not found or has been removed.`,
        });
      }

      if (hustle.status !== 'ACTIVE') {
        return res.status(400).json({
          success: false,
          error: `Listing '${hustle.title}' is currently unavailable (${hustle.status}).`,
        });
      }

      // Prevent buying own hustle
      if (hustle.sellerProfile.userId === buyerId) {
        return res.status(400).json({
          success: false,
          error: `You cannot purchase your own listing ('${hustle.title}').`,
        });
      }

      // Inventory check
      if (hustle.trackStock && hustle.stockQuantity < reqItem.quantity) {
        return res.status(409).json({
          success: false,
          error: `Insufficient inventory for '${hustle.title}'. Only ${hustle.stockQuantity} remaining.`,
        });
      }
    }

    // 6. Group items by Seller Profile (Multi-Seller Cart)
    interface SellerGroup {
      sellerProfileId: string;
      sellerProfile: any;
      meetupLocation: string;
      notesToSeller?: string;
      items: Array<{
        hustle: typeof hustles[0];
        quantity: number;
        unitPrice: number;
        lineTotal: number;
        meetupLocation: string;
        notesToSeller?: string;
      }>;
      subtotal: number;
    }

    const sellerGroups = new Map<string, SellerGroup>();

    for (const reqItem of requestItems) {
      const hustle = hustleMap.get(reqItem.hustleId)!;
      const sellerId = hustle.sellerProfileId;
      const unitPrice = Number(hustle.price);
      const lineTotal = Math.round(unitPrice * reqItem.quantity * 100) / 100;

      let group = sellerGroups.get(sellerId);
      if (!group) {
        group = {
          sellerProfileId: sellerId,
          sellerProfile: hustle.sellerProfile,
          meetupLocation: reqItem.meetupLocation,
          notesToSeller: reqItem.notesToSeller,
          items: [],
          subtotal: 0,
        };
        sellerGroups.set(sellerId, group);
      }

      group.items.push({
        hustle,
        quantity: reqItem.quantity,
        unitPrice,
        lineTotal,
        meetupLocation: reqItem.meetupLocation,
        notesToSeller: reqItem.notesToSeller,
      });

      group.subtotal = Math.round((group.subtotal + lineTotal) * 100) / 100;
    }

    // 7. Calculate server-side Total Amount
    let totalAmount = 0;
    for (const group of sellerGroups.values()) {
      totalAmount = Math.round((totalAmount + group.subtotal) * 100) / 100;
    }

    const orderNumber = generateOrderNumber(buyer.university?.code || 'CAMPUS');

    // 8. Execute Atomic Database Transaction
    const createdOrder = await prisma.$transaction(async (tx) => {
      // A. Decrement inventory for stock-tracked items
      for (const reqItem of requestItems) {
        const hustle = hustleMap.get(reqItem.hustleId)!;
        if (hustle.trackStock) {
          await tx.hustle.update({
            where: { id: hustle.id },
            data: {
              stockQuantity: {
                decrement: reqItem.quantity,
              },
            },
          });
        }
      }

      // B. Create Parent Order
      const parentOrder = await tx.order.create({
        data: {
          orderNumber,
          buyerId,
          totalAmount,
          currency: 'GHS',
          status: OrderStatus.PENDING_PAYMENT,
          idempotencyKey: idempotencyKey || null,
          campusCode: buyer.university?.code || 'KNUST',
          contactPhone,
        },
      });

      // C. Create SubOrders and OrderItems per seller
      let subOrderIndex = 0;
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

      for (const group of sellerGroups.values()) {
        const letter = alphabet[subOrderIndex % alphabet.length];
        const subOrderNumber = `${orderNumber}-${letter}`;
        subOrderIndex++;

        await tx.subOrder.create({
          data: {
            subOrderNumber,
            orderId: parentOrder.id,
            sellerProfileId: group.sellerProfileId,
            status: SubOrderStatus.PENDING_ACCEPTANCE,
            escrowStatus: EscrowStatus.HELD,
            subtotal: group.subtotal,
            meetupLocation: group.meetupLocation,
            notesToSeller: group.notesToSeller,
            items: {
              create: group.items.map((item) => ({
                hustleId: item.hustle.id,
                snapshotTitle: item.hustle.title,
                snapshotPrice: item.unitPrice,
                quantity: item.quantity,
                lineTotal: item.lineTotal,
              })),
            },
          },
        });
      }

      // Fetch complete created tree
      return tx.order.findUnique({
        where: { id: parentOrder.id },
        include: {
          buyer: true,
          subOrders: {
            include: {
              sellerProfile: { include: { user: true } },
              items: true,
            },
          },
        },
      });
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully. Ready for payment.',
      data: formatOrderResponse(createdOrder),
    });
  } catch (error: any) {
    console.error('Checkout Order Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Checkout failed' });
  }
};

// ============================================================================
// 2. GET MY ORDERS (Buyer View)
// ============================================================================
export const getMyOrders = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const buyerId = authReq.user?.id;

    if (!buyerId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const orders = await prisma.order.findMany({
      where: { buyerId },
      include: {
        buyer: true,
        subOrders: {
          include: {
            sellerProfile: { include: { user: true } },
            items: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      count: orders.length,
      data: orders.map(formatOrderResponse),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 3. GET ORDER BY ID (With Seller Data Privacy Scoping)
// ============================================================================
export const getOrderById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const userRole = authReq.user?.role;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        buyer: true,
        subOrders: {
          include: {
            sellerProfile: { include: { user: true } },
            items: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    // Authorization Check:
    // 1. Is the requester the buyer?
    const isBuyer = order.buyerId === userId;

    // 2. Is the requester one of the sellers?
    const sellerSubOrders = order.subOrders.filter(
      (so) => so.sellerProfile.userId === userId
    );
    const isSeller = sellerSubOrders.length > 0;
    const isAdmin = userRole === 'ADMIN' || userRole === 'MODERATOR';

    if (!isBuyer && !isSeller && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You do not have permission to view this order.',
      });
    }

    // Data Privacy: If a seller is viewing, only show their own sub-orders!
    if (isSeller && !isBuyer && !isAdmin) {
      const scopedOrder = {
        ...order,
        subOrders: sellerSubOrders,
      };
      return res.json({ success: true, data: formatOrderResponse(scopedOrder) });
    }

    res.json({ success: true, data: formatOrderResponse(order) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 4. GET SELLER INCOMING ORDERS (Seller View)
// ============================================================================
export const getSellerIncomingOrders = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const subOrders = await prisma.subOrder.findMany({
      where: {
        sellerProfile: { userId },
      },
      include: {
        order: { include: { buyer: true } },
        sellerProfile: { include: { user: true } },
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      count: subOrders.length,
      data: subOrders.map((so) => ({
        ...formatSubOrderResponse(so),
        buyerName: so.order?.buyer?.name,
        buyerPhone: so.order?.contactPhone || so.order?.buyer?.phoneNumber,
        orderNumber: so.order?.orderNumber,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 5. UPDATE SUB-ORDER STATUS (Seller Fulfillment Lifecycle)
// ============================================================================
export const updateSubOrderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const validation = updateSubOrderStatusSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status update',
        details: validation.error.flatten(),
      });
    }

    const targetStatus = validation.data.status as SubOrderStatus;

    // Verify SubOrder & Seller Ownership
    const subOrder = await prisma.subOrder.findUnique({
      where: { id },
      include: { sellerProfile: true },
    });

    if (!subOrder) {
      return res.status(404).json({ success: false, error: 'Sub-order not found' });
    }

    if (subOrder.sellerProfile.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You can only update sub-orders for your own seller profile.',
      });
    }

    const updateData: any = { status: targetStatus };
    if (targetStatus === SubOrderStatus.ACCEPTED) updateData.acceptedAt = new Date();
    if (targetStatus === SubOrderStatus.DELIVERED) updateData.deliveredAt = new Date();

    const updated = await prisma.subOrder.update({
      where: { id },
      data: updateData,
      include: {
        sellerProfile: { include: { user: true } },
        items: true,
      },
    });

    res.json({
      success: true,
      message: `Sub-order status updated to ${targetStatus}`,
      data: formatSubOrderResponse(updated),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 6. CONFIRM SUB-ORDER RECEIPT (Buyer Confirmation & Escrow Release)
// ============================================================================
export const confirmSubOrderReceipt = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Verify sub-order and that the requester is the buyer
    const subOrder = await prisma.subOrder.findUnique({
      where: { id },
      include: {
        order: {
          include: { subOrders: true },
        },
      },
    });

    if (!subOrder) {
      return res.status(404).json({ success: false, error: 'Sub-order not found' });
    }

    if (subOrder.order.buyerId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Only the buyer can confirm order receipt.',
      });
    }

    // Transition sub-order to COMPLETED and release escrow
    const updatedSubOrder = await prisma.$transaction(async (tx) => {
      const so = await tx.subOrder.update({
        where: { id },
        data: {
          status: SubOrderStatus.COMPLETED,
          escrowStatus: EscrowStatus.RELEASED_TO_SELLER,
          completedAt: new Date(),
        },
        include: {
          sellerProfile: { include: { user: true } },
          items: true,
        },
      });

      // Check if all sub-orders under this parent order are now completed
      const allSubOrders = await tx.subOrder.findMany({
        where: { orderId: subOrder.orderId },
      });

      const allCompleted = allSubOrders.every(
        (o) => o.status === SubOrderStatus.COMPLETED || o.status === SubOrderStatus.CANCELLED
      );

      if (allCompleted) {
        await tx.order.update({
          where: { id: subOrder.orderId },
          data: { status: OrderStatus.COMPLETED },
        });
      }

      return so;
    });

    res.json({
      success: true,
      message: 'Order confirmed and completed! Escrow released to seller.',
      data: formatSubOrderResponse(updatedSubOrder),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 7. CANCEL SUB-ORDER (Buyer/Seller Cancellation with Stock Restoration & Refund)
// ============================================================================
export const cancelSubOrder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const validation = cancelSubOrderSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid cancellation reason',
        details: validation.error.flatten(),
      });
    }

    const { reason } = validation.data;

    const subOrder = await prisma.subOrder.findUnique({
      where: { id },
      include: {
        order: true,
        sellerProfile: true,
        items: true,
      },
    });

    if (!subOrder) {
      return res.status(404).json({ success: false, error: 'Sub-order not found' });
    }

    const isBuyer = subOrder.order.buyerId === userId;
    const isSeller = subOrder.sellerProfile.userId === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You can only cancel your own orders.',
      });
    }

    // Cancellation Rules:
    // Buyer can cancel if PENDING_ACCEPTANCE
    if (isBuyer && subOrder.status !== SubOrderStatus.PENDING_ACCEPTANCE) {
      return res.status(400).json({
        success: false,
        error: 'Buyer cannot cancel an order that has already been accepted or delivered. Please raise a dispute instead.',
      });
    }

    // Seller can cancel if not already DELIVERED or COMPLETED
    if (isSeller && (subOrder.status === SubOrderStatus.DELIVERED || subOrder.status === SubOrderStatus.COMPLETED)) {
      return res.status(400).json({
        success: false,
        error: 'Cannot cancel an order that has already been delivered or completed.',
      });
    }

    // Execute cancellation transaction
    const cancelled = await prisma.$transaction(async (tx) => {
      // 1. Restore inventory
      for (const item of subOrder.items) {
        if (item.hustleId) {
          const h = await tx.hustle.findUnique({ where: { id: item.hustleId } });
          if (h && h.trackStock) {
            await tx.hustle.update({
              where: { id: item.hustleId },
              data: { stockQuantity: { increment: item.quantity } },
            });
          }
        }
      }

      // 2. Update sub-order
      return tx.subOrder.update({
        where: { id },
        data: {
          status: SubOrderStatus.CANCELLED,
          escrowStatus: EscrowStatus.REFUNDED_TO_BUYER,
          cancelledAt: new Date(),
          cancellationReason: reason,
          cancelledByUserId: userId,
        },
        include: {
          sellerProfile: { include: { user: true } },
          items: true,
        },
      });
    });

    res.json({
      success: true,
      message: 'Sub-order cancelled successfully. Funds marked for refund.',
      data: formatSubOrderResponse(cancelled),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 8. DISPUTE SUB-ORDER (Freezes Escrow & Alerts Moderation)
// ============================================================================
export const disputeSubOrder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const validation = disputeSubOrderSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid dispute reason (min 5 characters)',
        details: validation.error.flatten(),
      });
    }

    const subOrder = await prisma.subOrder.findUnique({
      where: { id },
      include: {
        order: true,
        sellerProfile: true,
      },
    });

    if (!subOrder) {
      return res.status(404).json({ success: false, error: 'Sub-order not found' });
    }

    const isBuyer = subOrder.order.buyerId === userId;
    const isSeller = subOrder.sellerProfile.userId === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You are neither the buyer nor seller of this order.',
      });
    }

    const disputed = await prisma.subOrder.update({
      where: { id },
      data: {
        status: SubOrderStatus.DISPUTED,
        escrowStatus: EscrowStatus.DISPUTED,
      },
      include: {
        sellerProfile: { include: { user: true } },
        items: true,
      },
    });

    res.json({
      success: true,
      message: 'Dispute opened. Escrow funds frozen pending campus moderation.',
      data: formatSubOrderResponse(disputed),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
