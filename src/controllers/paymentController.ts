import { Request, Response } from 'express';
import { getDatabase } from '../db/database';

export const initializePayment = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { hustleId, buyerEmail, momoNumber, paymentMethod = 'mtn_momo' } = req.body;

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

    // Insert pending transaction record in SQLite
    await db.run(
      `INSERT INTO transactions 
      (id, hustle_id, buyer_email, seller_name, amount, payment_method, momo_number, status, reference, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
      ]
    );

    // Paystack Ghana Mobile Money Integration Payload format
    const paymentPrompt = {
      reference,
      amount: hustle.price,
      currency: 'GHS',
      recipientSeller: hustle.seller_name,
      momoNumber,
      provider: paymentMethod.toUpperCase(),
      checkoutUrl: `https://checkout.paystack.com/simulate_knust_${reference}`,
      instructions: `A Mobile Money prompt of GH₵ ${hustle.price} has been sent to ${momoNumber}. Please authorize on your phone to complete payment.`,
    };

    res.status(201).json({
      success: true,
      message: '💳 Mobile Money Payment Prompt Initialized!',
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

    // Simulate verification update to 'success'
    await db.run('UPDATE transactions SET status = ? WHERE reference = ?', ['success', reference]);

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
        completedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getTransactionHistory = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { email } = req.query;

    let query = 'SELECT * FROM transactions';
    const params: any[] = [];

    if (email) {
      query += ' WHERE buyer_email = ?';
      params.push((email as string).toLowerCase());
    }

    query += ' ORDER BY created_at DESC';

    const rows = await db.all(query, params);

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
