import https from 'https';
import crypto from 'crypto';

/**
 * Ghana SMS Gateway Service
 * Primary Provider: BMS Africa / mNotify (Official REST API v2.0)
 * Reference: https://developer.bms.africa/ | https://bms.africa/otp
 */

export interface SendSmsResult {
  success: boolean;
  phone: string;
  message: string;
  simulated: boolean;
  provider: string;
  campaignId?: string;
  error?: string;
}

/**
 * Formats a raw Ghana phone number to international E.164 (e.g. +233535469296)
 */
export function formatToGhanaE164(rawPhone: string): string {
  const cleaned = rawPhone.replace(/\D/g, '');

  if (cleaned.startsWith('233') && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `+233${cleaned.substring(1)}`;
  }
  if (cleaned.length === 9) {
    return `+233${cleaned}`;
  }

  return `+${cleaned}`;
}

/**
 * Formats a Ghana phone number for BMS recipient payload (e.g. "0535469296" or "233535469296")
 */
export function formatForBmsRecipient(rawPhone: string): string {
  const cleaned = rawPhone.replace(/\D/g, '');
  if (cleaned.startsWith('233') && cleaned.length === 12) {
    return cleaned;
  }
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `233${cleaned.substring(1)}`;
  }
  if (cleaned.length === 9) {
    return `233${cleaned}`;
  }
  return cleaned;
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP using hardware CSPRNG entropy
 */
export function generateNumericOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Helper to mask phone numbers for safe logging / response (e.g. "+233 53 •••• 296")
 */
export function maskPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 9) return '••••••••••';
  const prefix = cleaned.slice(0, 5);
  const suffix = cleaned.slice(-3);
  return `+${prefix.slice(0, 3)} ${prefix.slice(3)} •••• ${suffix}`;
}

/**
 * Dispatches a 6-digit verification code via SMS to a Ghanaian mobile number
 * Uses BMS Africa / mNotify with official OTP routing (`sms_type: "otp"`)
 */
export async function sendSmsOtp(params: {
  phone: string;
  otp: string;
  purpose: 'register' | 'login' | 'phone_verification';
  campusName?: string;
}): Promise<SendSmsResult> {
  const { phone, otp, purpose, campusName = 'CampusHustle' } = params;
  const formattedPhone = formatToGhanaE164(phone);

  const message =
    purpose === 'register' || purpose === 'phone_verification'
      ? `Your ${campusName} verification code is: ${otp}. Valid for 10 minutes. Do not share this code with anyone.`
      : `Your ${campusName} login code is: ${otp}. Use this to securely access your student account. Valid for 10 minutes.`;

  const mNotifyKey = process.env.MNOTIFY_API_KEY?.trim();

  // 1. Production / Live Dispatch via BMS Africa (mNotify)
  if (mNotifyKey) {
    try {
      const bmsResult = await sendViaMNotify(mNotifyKey, formattedPhone, message);
      return {
        success: true,
        phone: formattedPhone,
        message,
        simulated: false,
        provider: 'BMS Africa (mNotify)',
        campaignId: bmsResult.summary?._id,
      };
    } catch (err: any) {
      console.error('⚠️ BMS Africa dispatch failure:', err.message);
      // Strict rule: Fail closed. Do not silently fall back to other providers or simulator
      throw new Error(
        'Failed to dispatch SMS verification code through telecom provider. Please verify your phone number and try again.'
      );
    }
  }

  // 2. Production Protection: Refuse mock SMS in production
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL SECURITY ERROR: MNOTIFY_API_KEY is not configured on this production server.');
  }

  // 3. Gated Development Simulator
  const isDevOtpMode = process.env.DEV_OTP_MODE === 'true';
  const allowMockSms = process.env.ALLOW_MOCK_SMS === 'true';

  if (allowMockSms || isDevOtpMode) {
    const displayOtp = isDevOtpMode ? otp : '******';
    console.log('\n============================================================');
    console.log('📱 [GHANA TELECOM SMS GATEWAY - DEV SIMULATOR]');
    console.log(`📡 Recipient (Ghana SIM): ${maskPhoneNumber(formattedPhone)}`);
    console.log(`🏢 Sender ID:            ${process.env.BMS_SENDER_ID || 'CampHustle'}`);
    console.log(`🎯 Purpose:              ${purpose.toUpperCase()}`);
    console.log(`🔑 6-Digit OTP Code:     >>> ${displayOtp} <<<`);
    console.log(`⏱️ Expiry:               10 Minutes`);
    console.log('✅ Status:               DISPATCHED (Local Dev Mode)');
    console.log('============================================================\n');

    return {
      success: true,
      phone: formattedPhone,
      message,
      simulated: true,
      provider: 'Dev Simulator',
    };
  }

  throw new Error('SMS service is unavailable. Please configure MNOTIFY_API_KEY in environment variables.');
}

/**
 * BMS Africa / mNotify Official API Integration
 * Endpoint: POST https://api.mnotify.com/api/sms/quick?key=YOUR_API_KEY
 * Payload includes documented: sms_type: "otp"
 */
export function sendViaMNotify(apiKey: string, toPhone: string, message: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const senderId = (process.env.BMS_SENDER_ID || 'CampHustle').trim().slice(0, 11);
    const recipientFormatted = formatForBmsRecipient(toPhone);

    const postData = JSON.stringify({
      recipient: [recipientFormatted],
      sender: senderId,
      message,
      is_schedule: false,
      sms_type: 'otp', // Documented BMS OTP activation flag
    });

    const options = {
      hostname: 'api.mnotify.com',
      port: 443,
      path: `/api/sms/quick?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        Accept: 'application/json',
      },
      timeout: 12000, // 12 seconds timeout
    };

    const req = https.request(options, (res) => {
      let rawData = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        rawData += chunk;
      });

      res.on('end', () => {
        let parsed: any;
        try {
          parsed = JSON.parse(rawData || '{}');
        } catch (parseErr) {
          return reject(
            new Error(
              `BMS gateway returned malformed response (HTTP ${res.statusCode}): ${rawData.slice(0, 100)}`
            )
          );
        }

        // 1. Validate HTTP Status
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          const errMsg = parsed.message || parsed.error || `HTTP ${res.statusCode}`;
          return reject(new Error(`BMS gateway error: ${errMsg}`));
        }

        // 2. Validate Documented BMS Status & Code
        // Official BMS success signature: status: "success", code: "2000"
        if (parsed.status !== 'success' || parsed.code !== '2000') {
          const errMsg = parsed.message || `BMS rejection code ${parsed.code || 'UNKNOWN'}`;
          return reject(new Error(`BMS provider rejected SMS: ${errMsg}`));
        }

        // 3. Validate Summary Rejections if available
        if (parsed.summary && typeof parsed.summary.total_rejected === 'number' && parsed.summary.total_rejected > 0) {
          return reject(
            new Error(`BMS rejected delivery to recipient: ${parsed.message || 'Number rejected'}`)
          );
        }

        resolve(parsed);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('BMS gateway connection timed out after 12000ms.'));
    });

    req.on('error', (e) => {
      reject(new Error(`Network error contacting BMS gateway: ${e.message}`));
    });

    req.write(postData);
    req.end();
  });
}
