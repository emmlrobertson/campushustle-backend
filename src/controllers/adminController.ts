import { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { ReportStatus, HustleStatus } from '@prisma/client';
import { z } from 'zod';

const resolveReportSchema = z.object({
  status: z.enum(['ACTIONED', 'DISMISSED', 'INVESTIGATING']),
  adminNotes: z.string().optional(),
});

const userStatusSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().optional(),
});

const hustleModerationSchema = z.object({
  status: z.enum(['ACTIVE', 'UNDER_REVIEW', 'ARCHIVED']),
  reason: z.string().optional(),
});

/**
 * GET /api/admin/reports
 * List reported users or hustles
 */
export const getReports = async (req: Request, res: Response) => {
  try {
    const statusQuery = req.query.status as string;
    const where: any = {};
    if (statusQuery && ['PENDING', 'INVESTIGATING', 'ACTIONED', 'DISMISSED'].includes(statusQuery.toUpperCase())) {
      where.status = statusQuery.toUpperCase() as ReportStatus;
    }

    const reports = await prisma.report.findMany({
      where,
      include: {
        reporter: { select: { id: true, name: true, email: true } },
        reportedUser: { select: { id: true, name: true, email: true } },
        hustle: { select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      count: reports.length,
      data: reports,
    });
  } catch (error: any) {
    console.error('getReports error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch moderation reports' });
  }
};

/**
 * PATCH /api/admin/reports/:id
 * Take action on a report and record an audit log
 */
export const resolveReport = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const adminId = authReq.user!.id;
    const { id } = req.params;

    const validation = resolveReportSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ success: false, error: 'Invalid report status update' });
    }

    const { status, adminNotes } = validation.data;

    const updated = await prisma.$transaction(async (tx) => {
      const report = await tx.report.update({
        where: { id },
        data: {
          status: status as ReportStatus,
          adminNotes,
        },
      });

      await tx.moderationLog.create({
        data: {
          adminId,
          action: `REPORT_${status}`,
          targetId: id,
          details: adminNotes || `Report ${status.toLowerCase()} by moderator`,
        },
      });

      return report;
    });

    res.json({
      success: true,
      message: `Report status updated to ${status}`,
      data: updated,
    });
  } catch (error: any) {
    console.error('resolveReport error:', error);
    res.status(500).json({ success: false, error: 'Failed to update report' });
  }
};

/**
 * PATCH /api/admin/users/:id/status
 * Activate or deactivate student user (revokes active JWT sessions)
 */
export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const adminId = authReq.user!.id;
    const { id } = req.params;

    const validation = userStatusSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ success: false, error: 'Invalid user status payload' });
    }

    const { isActive, reason } = validation.data;

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          isActive,
          tokenVersion: { increment: 1 }, // Invalidate all active tokens immediately
        },
        select: { id: true, name: true, email: true, isActive: true, role: true },
      });

      await tx.moderationLog.create({
        data: {
          adminId,
          action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
          targetId: id,
          details: reason || `User account ${isActive ? 'activated' : 'deactivated'}`,
        },
      });

      return user;
    });

    res.json({
      success: true,
      message: `User account has been ${isActive ? 'activated' : 'deactivated'}.`,
      data: updatedUser,
    });
  } catch (error: any) {
    console.error('updateUserStatus error:', error);
    res.status(500).json({ success: false, error: 'Failed to update user status' });
  }
};

/**
 * PATCH /api/admin/hustles/:id/status
 * Administrative moderation of hustle listings
 */
export const moderateHustle = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const adminId = authReq.user!.id;
    const { id } = req.params;

    const validation = hustleModerationSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ success: false, error: 'Invalid moderation action' });
    }

    const { status, reason } = validation.data;

    const updated = await prisma.$transaction(async (tx) => {
      const hustle = await tx.hustle.update({
        where: { id },
        data: { status: status as HustleStatus },
      });

      await tx.moderationLog.create({
        data: {
          adminId,
          action: `HUSTLE_STATUS_${status}`,
          targetId: id,
          details: reason || `Listing status set to ${status}`,
        },
      });

      return hustle;
    });

    res.json({
      success: true,
      message: `Hustle listing updated to ${status}`,
      data: updated,
    });
  } catch (error: any) {
    console.error('moderateHustle error:', error);
    res.status(500).json({ success: false, error: 'Failed to moderate hustle listing' });
  }
};

/**
 * GET /api/admin/logs
 * View audit trail of moderation actions
 */
export const getModerationLogs = async (req: Request, res: Response) => {
  try {
    const logs = await prisma.moderationLog.findMany({
      include: {
        admin: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error: any) {
    console.error('getModerationLogs error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve moderation logs' });
  }
};
