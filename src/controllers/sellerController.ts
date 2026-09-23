import { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { PaymentMethod } from '@prisma/client';
import {
  validateGhanaPayoutAccount,
  maskGhanaPhoneNumber,
  normalizeGhanaPhoneNumber,
} from '../utils/payoutValidation';
import { createPaystackTransferRecipient } from '../services/paystackService';

/**
 * GET /api/seller/payout-account
 * Retrieves the payout account settings for the currently authenticated seller
 */
export async function getPayoutAccount(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required to view payout settings.',
      });
    }

    const sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!sellerProfile) {
      return res.status(200).json({
        success: true,
        data: {
          hasConfiguredPayout: false,
          isPayoutVerified: false,
          payoutMomoNetwork: null,
          maskedPhoneNumber: null,
          verifiedAccountName: null,
        },
      });
    }

    const hasConfiguredPayout = Boolean(
      sellerProfile.paystackRecipientCode && sellerProfile.isPayoutVerified
    );

    return res.status(200).json({
      success: true,
      data: {
        hasConfiguredPayout,
        isPayoutVerified: sellerProfile.isPayoutVerified,
        businessName: sellerProfile.businessName,
        payoutMomoNetwork: sellerProfile.payoutMomoNetwork,
        maskedPhoneNumber: maskGhanaPhoneNumber(sellerProfile.payoutMomoNumber),
        verifiedAccountName: sellerProfile.verifiedAccountName,
        totalSalesCount: sellerProfile.totalSalesCount,
      },
    });
  } catch (error: any) {
    console.error('Error fetching payout account:', error);
    return res.status(500).json({
      success: false,
      error: 'An internal error occurred while retrieving payout settings.',
    });
  }
}

/**
 * PUT /api/seller/payout-account
 * Configures or updates the Ghanaian Mobile Money payout destination for the authenticated seller
 */
export async function updatePayoutAccount(req: Request, res: Response) {
  try {
    // 1. Strict Authorization: Never trust client-supplied seller IDs
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required to configure payout settings.',
      });
    }

    const { network, phoneNumber, accountName } = req.body;

    // 2. Validate supported Mobile Money Network
    if (!network || !Object.values(PaymentMethod).includes(network)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing network. Must be MTN_MOMO, TELECEL_CASH, or AIRTEL_TIGO_MONEY.',
      });
    }

    if (network === PaymentMethod.CARD) {
      return res.status(400).json({
        success: false,
        error: 'Card is not a valid payout recipient network in Ghana. Please use Mobile Money.',
      });
    }

    // 3. Validate Account Holder / Display Name
    if (!accountName || typeof accountName !== 'string' || accountName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid account holder name (at least 2 characters).',
      });
    }

    // 4. Server-Side Phone Number Normalization & Carrier Prefix Validation
    const validation = validateGhanaPayoutAccount(network as PaymentMethod, phoneNumber);
    if (!validation.isValid || !validation.normalizedNumber || !validation.paystackBankCode) {
      return res.status(400).json({
        success: false,
        error: validation.error || 'Invalid Ghanaian Mobile Money phone number.',
      });
    }

    // 5. Retrieve or initialize Caller's Seller Profile
    let sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!sellerProfile) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({ success: false, error: 'User account not found.' });
      }

      sellerProfile = await prisma.sellerProfile.create({
        data: {
          userId,
          businessName: user.name,
          payoutMomoNumber: validation.normalizedNumber,
          payoutMomoNetwork: network as PaymentMethod,
          isPayoutVerified: false,
        },
        include: { user: true },
      });
    }

    // 6. Verification Invalidation Check:
    // If payout details changed, the previous verification state must be invalidated
    const currentNormalized = normalizeGhanaPhoneNumber(sellerProfile.payoutMomoNumber);
    const hasDetailsChanged =
      currentNormalized !== validation.normalizedNumber ||
      sellerProfile.payoutMomoNetwork !== network ||
      sellerProfile.verifiedAccountName !== accountName.trim();

    if (hasDetailsChanged && sellerProfile.isPayoutVerified) {
      // Invalidate existing payout verification
      await prisma.sellerProfile.update({
        where: { id: sellerProfile.id },
        data: {
          isPayoutVerified: false,
        },
      });
    }

    // 7. Server-Side Paystack Recipient Creation
    const recipientResult = await createPaystackTransferRecipient({
      name: accountName.trim(),
      accountNumber: validation.normalizedNumber,
      bankCode: validation.paystackBankCode,
      currency: 'GHS',
    });

    // 8. Commit Verified Payout Settings to PostgreSQL
    const updatedProfile = await prisma.sellerProfile.update({
      where: { id: sellerProfile.id },
      data: {
        payoutMomoNetwork: network as PaymentMethod,
        payoutMomoNumber: validation.normalizedNumber,
        paystackRecipientCode: recipientResult.recipientCode,
        verifiedAccountName: recipientResult.accountName,
        isPayoutVerified: true, // Now verified with Paystack recipient code
      },
    });

    // 9. Audit Logging for Compliance & Security
    try {
      await prisma.moderationLog.create({
        data: {
          adminId: userId, // Performed by user on their own account
          action: hasDetailsChanged ? 'PAYOUT_ACCOUNT_UPDATED' : 'PAYOUT_ACCOUNT_CONFIGURED',
          targetId: updatedProfile.id,
          details: JSON.stringify({
            event: 'SELLER_PAYOUT_DESTINATION_UPDATED',
            userId,
            sellerProfileId: updatedProfile.id,
            network: updatedProfile.payoutMomoNetwork,
            maskedPhoneNumber: maskGhanaPhoneNumber(updatedProfile.payoutMomoNumber),
            recipientCode: recipientResult.recipientCode,
            isSimulated: recipientResult.isSimulated,
            timestamp: new Date().toISOString(),
          }),
        },
      });
    } catch (auditErr) {
      console.warn('Audit log write notice:', auditErr);
    }

    // 10. Minimal Disclosure Response: Do not expose secret gateway tokens
    return res.status(200).json({
      success: true,
      message: 'Mobile Money payout destination verified and updated successfully.',
      data: {
        hasConfiguredPayout: true,
        isPayoutVerified: updatedProfile.isPayoutVerified,
        payoutMomoNetwork: updatedProfile.payoutMomoNetwork,
        maskedPhoneNumber: maskGhanaPhoneNumber(updatedProfile.payoutMomoNumber),
        verifiedAccountName: updatedProfile.verifiedAccountName,
      },
    });
  } catch (error: any) {
    console.error('Error updating payout account:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An error occurred while updating payout settings.',
    });
  }
}
