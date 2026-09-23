import crypto from 'crypto';

export interface PaystackRecipientResult {
  recipientCode: string;
  accountName: string;
  accountNumber: string;
  bankCode: string;
  currency: string;
  isSimulated: boolean;
}

const getPaystackSecretKey = () => (process.env.PAYSTACK_SECRET_KEY || '').trim();

/**
 * Creates or retrieves a Transfer Recipient on Paystack server-side
 * Never call this from mobile client or expose PAYSTACK_SECRET_KEY.
 */
export async function createPaystackTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
  currency?: string;
}): Promise<PaystackRecipientResult> {
  const { name, accountNumber, bankCode, currency = 'GHS' } = params;
  const secretKey = getPaystackSecretKey();

  // If secret key is not configured (e.g. local dev / automated test suite), use secure deterministic simulation
  if (!secretKey) {
    const hash = crypto
      .createHash('sha256')
      .update(`${bankCode}_${accountNumber}`)
      .digest('hex')
      .substring(0, 16);

    return {
      recipientCode: `RCP_sim_${hash}`,
      accountName: name.trim(),
      accountNumber,
      bankCode,
      currency,
      isSimulated: true,
    };
  }

  // Live Paystack API Request
  try {
    const response = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'mobile_money',
        name: name.trim(),
        account_number: accountNumber,
        bank_code: bankCode,
        currency,
      }),
    });

    const data = (await response.json()) as any;

    if (!response.ok || !data.status) {
      const errorMsg = data?.message || `Paystack API returned status ${response.status}`;
      throw new Error(`Paystack recipient creation failed: ${errorMsg}`);
    }

    const recipientCode = data.data?.recipient_code;
    if (!recipientCode) {
      throw new Error('Paystack response missing recipient_code');
    }

    return {
      recipientCode,
      accountName: data.data?.details?.account_name || data.data?.name || name.trim(),
      accountNumber: data.data?.details?.account_number || accountNumber,
      bankCode,
      currency,
      isSimulated: false,
    };
  } catch (error: any) {
    // If running in development with an unreachable or invalid key, provide controlled fallback
    if (process.env.NODE_ENV !== 'production' && error.message.includes('fetch failed')) {
      const hash = crypto
        .createHash('sha256')
        .update(`${bankCode}_${accountNumber}`)
        .digest('hex')
        .substring(0, 16);

      return {
        recipientCode: `RCP_sim_${hash}`,
        accountName: name.trim(),
        accountNumber,
        bankCode,
        currency,
        isSimulated: true,
      };
    }
    throw error;
  }
}
