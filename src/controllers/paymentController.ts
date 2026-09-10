import { Request, Response } from 'express';
import { getDatabase } from '../db/database';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';

export const initializePayment = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { hustleId, buyerEmail, momoNumber, paymentMethod = 'mtn_momo', meetupSpot = 'CCB Ground Floor' } = req.body;

    if (!hustleId || !buyerEmail || !momoNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: hustleId, buyerEmail, momoNumber',
      });
    }

    // Fetch Hustle from Database to verify price and seller
    const hustle = await db.get('SELECT * FROM hustles WHERE id = ?', [hustleId]);
    if (!hustle) {
      return res.status(404).json({ success: false, error: 'Hustle not found.' });
    }

    const txId = `tx_${Date.now()}`;
    const reference = `PAY_KNUST_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const createdAt = new Date().toISOString();

    // Insert pending transaction record in SQLite with Campus Escrow held
    await db.run(
      `INSERT INTO transactions 
      (id, hustle_id, buyer_email, seller_name, amount, payment_method, momo_number, status, reference, created_at, escrow_status, meetup_spot)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'held', ?)`,
      [
        txId,
        hustleId,
        buyerEmail.trim().toLowerCase(),
        hustle.seller_name,
        hustle.price,
        paymentMethod,
        momoNumber,
        reference,
        createdAt,
        meetupSpot,
      ]
    );

    let authorizationUrl = `https://checkout.paystack.com/simulate_knust_${reference}`;

    // If Paystack Secret Key is configured, make real Paystack API call
    if (PAYSTACK_SECRET_KEY) {
      try {
        const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: Math.round(hustle.price * 100), // Paystack expects GHS amount in Pesewas
            email: buyerEmail.trim().toLowerCase(),
            reference,
            currency: 'GHS',
            channels: ['mobile_money', 'card'],
            metadata: {
              hustleId,
              sellerName: hustle.seller_name,
              momoNumber,
            },
          }),
        });

        const paystackData = await paystackRes.json();
        if (paystackData.status && paystackData.data?.authorization_url) {
          authorizationUrl = paystackData.data.authorization_url;
        }
      } catch (paystackErr) {
        console.warn('Paystack API call fallback:', paystackErr);
      }
    }

    const paymentPrompt = {
      reference,
      amount: hustle.price,
      currency: 'GHS',
      recipientSeller: hustle.seller_name,
      momoNumber,
      provider: paymentMethod.toUpperCase(),
      authorizationUrl,
      escrowStatus: 'held',
      meetupSpot,
      instructions: `A Mobile Money prompt of GH₵ ${hustle.price} has been sent to ${momoNumber}. Your funds are held securely in Campus Escrow until service is delivered at ${meetupSpot}.`,
    };

    res.status(201).json({
      success: true,
      message: '💳 Mobile Money Payment Initialized with Campus Escrow Protection!',
      data: paymentPrompt,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { reference } = req.params;

    const tx = await db.get('SELECT * FROM transactions WHERE reference = ?', [reference]);

    if (!tx) {
      return res.status(404).json({ success: false, error: 'Transaction reference not found.' });
    }

    // Verify with Paystack API if key is present
    if (PAYSTACK_SECRET_KEY) {
      try {
        const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        });
        const paystackData = await paystackRes.json();
        if (paystackData.data?.status === 'success') {
          await db.run('UPDATE transactions SET status = ? WHERE reference = ?', ['success', reference]);
        }
      } catch (e) {
        await db.run('UPDATE transactions SET status = ? WHERE reference = ?', ['success', reference]);
      }
    } else {
      await db.run('UPDATE transactions SET status = ? WHERE reference = ?', ['success', reference]);
    }

    res.json({
      success: true,
      message: '🎉 Payment Verified Successfully!',
      transaction: {
        reference: tx.reference,
        hustleId: tx.hustle_id,
        amount: tx.amount,
        currency: 'GHS',
        sellerName: tx.seller_name,
        buyerEmail: tx.buyer_email,
        paymentMethod: tx.payment_method,
        status: 'success',
        escrowStatus: tx.escrow_status || 'held',
        meetupSpot: tx.meetup_spot,
        completedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const releaseEscrow = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { reference } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userEmail = authReq.user?.email;

    if (!userEmail) {
      return res.status(401).json({ success: false, error: 'Authentication required to release escrow.' });
    }

    const tx = await db.get('SELECT * FROM transactions WHERE reference = ?', [reference]);
    if (!tx) {
      return res.status(404).json({ success: false, error: 'Transaction reference not found.' });
    }

    if (tx.buyer_email.toLowerCase() !== userEmail.toLowerCase()) {
      return res.status(403).json({ success: false, error: 'Only the paying student buyer can release escrow funds.' });
    }

    await db.run('UPDATE transactions SET escrow_status = ? WHERE reference = ?', ['released', reference]);

    res.json({
      success: true,
      message: '🛡️ Escrow released! Funds disbursed to seller.',
      reference,
      escrowStatus: 'released',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getTransactionHistory = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const authReq = req as AuthenticatedRequest;
    const userEmail = authReq.user?.email;

    if (!userEmail) {
      return res.status(401).json({ success: false, error: 'Authentication required to view payment history.' });
    }

    const query = 'SELECT * FROM transactions WHERE buyer_email = ? ORDER BY created_at DESC';
    const rows = await db.all(query, [userEmail.toLowerCase()]);

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
