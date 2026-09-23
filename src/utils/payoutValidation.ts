import { PaymentMethod } from '@prisma/client';

export interface PayoutAccountValidationResult {
  isValid: boolean;
  normalizedNumber?: string; // 10-digit national format: "0241234567"
  e164Number?: string;       // International E.164: "+233241234567"
  paystackBankCode?: string; // "MTN" | "VOD" | "ATL"
  error?: string;
}

// Paystack Ghana Mobile Money Bank Codes
export const PAYSTACK_MOMO_BANK_CODES: Record<PaymentMethod, string | null> = {
  [PaymentMethod.MTN_MOMO]: 'MTN',
  [PaymentMethod.TELECEL_CASH]: 'VOD',
  [PaymentMethod.AIRTEL_TIGO_MONEY]: 'ATL',
  [PaymentMethod.CARD]: null, // Not a payout destination
};

// Ghana Mobile Money Network Prefixes
const NETWORK_PREFIXES: Record<PaymentMethod, string[]> = {
  [PaymentMethod.MTN_MOMO]: ['024', '054', '055', '059', '053'],
  [PaymentMethod.TELECEL_CASH]: ['020', '050'],
  [PaymentMethod.AIRTEL_TIGO_MONEY]: ['027', '057', '026', '056'],
  [PaymentMethod.CARD]: [],
};

/**
 * Normalizes any Ghanaian phone string to 10-digit national representation (0XXXXXXXXX)
 */
export function normalizeGhanaPhoneNumber(rawPhone: string): string | null {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const digits = rawPhone.replace(/\D/g, '');

  if (digits.startsWith('233') && digits.length === 12) {
    return `0${digits.substring(3)}`;
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return digits;
  }
  if (digits.length === 9) {
    return `0${digits}`;
  }
  return null;
}

/**
 * Normalizes any Ghanaian phone string to international E.164 (+233XXXXXXXXX)
 */
export function normalizeToE164(nationalNumber: string): string {
  const digits = nationalNumber.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) {
    return `+233${digits.substring(1)}`;
  }
  if (digits.startsWith('233') && digits.length === 12) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

/**
 * Masks Ghanaian phone numbers for secure presentation in responses and logs
 * Example: "0241234567" -> "024 ••• •567"
 */
export function maskGhanaPhoneNumber(phone: string): string {
  const normalized = normalizeGhanaPhoneNumber(phone) || phone.replace(/\D/g, '');
  if (normalized.length >= 7) {
    const prefix = normalized.slice(0, 3);
    const suffix = normalized.slice(-3);
    return `${prefix} ••• ••• ${suffix}`;
  }
  return '••••••••••';
}

/**
 * Server-side validation of Ghanaian Mobile Money payout destinations
 */
export function validateGhanaPayoutAccount(
  network: PaymentMethod,
  rawPhone: string
): PayoutAccountValidationResult {
  // 1. Verify supported Mobile Money network
  const bankCode = PAYSTACK_MOMO_BANK_CODES[network];
  if (!bankCode) {
    return {
      isValid: false,
      error: `Unsupported payout network "${network}". Supported networks are MTN_MOMO, TELECEL_CASH, and AIRTEL_TIGO_MONEY.`,
    };
  }

  // 2. Normalize phone number
  const normalized = normalizeGhanaPhoneNumber(rawPhone);
  if (!normalized) {
    return {
      isValid: false,
      error: 'Invalid Ghanaian phone number format. Must be a valid 10-digit number (e.g. 024XXXXXXX) or international +233 format.',
    };
  }

  // 3. Verify carrier prefix matches chosen network
  const prefix = normalized.substring(0, 3);
  const allowedPrefixes = NETWORK_PREFIXES[network];

  if (!allowedPrefixes.includes(prefix)) {
    const readableNetwork =
      network === PaymentMethod.MTN_MOMO
        ? 'MTN Mobile Money'
        : network === PaymentMethod.TELECEL_CASH
        ? 'Telecel Cash'
        : 'AirtelTigo Money';

    return {
      isValid: false,
      error: `Prefix "${prefix}" is not a valid ${readableNetwork} prefix. Supported ${readableNetwork} prefixes: ${allowedPrefixes.join(', ')}.`,
    };
  }

  return {
    isValid: true,
    normalizedNumber: normalized,
    e164Number: normalizeToE164(normalized),
    paystackBankCode: bankCode,
  };
}
