import { z } from 'zod';

export const orderItemInputSchema = z.object({
  hustleId: z.string().min(1, 'hustleId is required'),
  quantity: z.coerce
    .number()
    .int('Quantity must be an integer')
    .min(1, 'Quantity must be at least 1')
    .max(100, 'Quantity cannot exceed 100'),
  meetupLocation: z
    .string()
    .min(3, 'Meetup location must be at least 3 characters')
    .max(120, 'Meetup location cannot exceed 120 characters')
    .trim(),
  notesToSeller: z.string().max(500, 'Notes cannot exceed 500 characters').trim().optional(),
});

export const checkoutOrderSchema = z.object({
  items: z
    .array(orderItemInputSchema)
    .min(1, 'At least one item is required for checkout')
    .max(20, 'Cannot checkout more than 20 items at once'),
  contactPhone: z
    .string()
    .min(9, 'Contact phone must be a valid phone number')
    .max(20, 'Contact phone cannot exceed 20 characters')
    .trim(),
  idempotencyKey: z.string().max(100).optional(),
});

export const updateSubOrderStatusSchema = z.object({
  status: z.enum([
    'ACCEPTED',
    'IN_PROGRESS',
    'READY_FOR_PICKUP',
    'DELIVERED',
  ]),
});

export const cancelSubOrderSchema = z.object({
  reason: z
    .string()
    .min(3, 'Cancellation reason must be at least 3 characters')
    .max(500, 'Reason cannot exceed 500 characters')
    .trim(),
});

export const disputeSubOrderSchema = z.object({
  reason: z
    .string()
    .min(5, 'Dispute reason must be at least 5 characters')
    .max(1000, 'Dispute reason cannot exceed 1000 characters')
    .trim(),
});
