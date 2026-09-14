import { z } from 'zod';

export const createHustleSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(120, 'Title cannot exceed 120 characters')
    .trim(),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(3000, 'Description cannot exceed 3000 characters')
    .trim(),
  price: z.coerce
    .number()
    .min(0, 'Price cannot be negative')
    .max(100000, 'Price cannot exceed GH₵ 100,000'),
  priceType: z
    .enum(['flat', 'hourly', 'starting_at', 'negotiable', 'FLAT', 'HOURLY', 'STARTING_AT', 'NEGOTIABLE'])
    .optional()
    .default('flat'),
  category: z
    .string()
    .min(1, 'Category cannot be empty'),
  hostelLocation: z.string().max(100).optional(),
  whatsAppNumber: z.string().max(30).optional(),
  deliveryMode: z
    .enum(['to_client', 'at_seller', 'campus_spot', 'remote', 'TO_CLIENT', 'AT_SELLER', 'CAMPUS_SPOT', 'REMOTE'])
    .optional()
    .default('to_client'),
  status: z
    .enum(['ACTIVE', 'BUSY', 'PAUSED', 'SOLD_OUT', 'OPEN'])
    .optional()
    .default('ACTIVE'),
  imageUrl: z.string().max(1000).optional(),
  images: z.array(z.string().max(1000)).max(10).optional(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
});

export const updateHustleSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(120, 'Title cannot exceed 120 characters')
    .trim()
    .optional(),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(3000, 'Description cannot exceed 3000 characters')
    .trim()
    .optional(),
  price: z.coerce
    .number()
    .min(0, 'Price cannot be negative')
    .max(100000, 'Price cannot exceed GH₵ 100,000')
    .optional(),
  priceType: z
    .enum(['flat', 'hourly', 'starting_at', 'negotiable', 'FLAT', 'HOURLY', 'STARTING_AT', 'NEGOTIABLE'])
    .optional(),
  category: z.string().min(1).optional(),
  hostelLocation: z.string().max(100).optional(),
  whatsAppNumber: z.string().max(30).optional(),
  deliveryMode: z
    .enum(['to_client', 'at_seller', 'campus_spot', 'remote', 'TO_CLIENT', 'AT_SELLER', 'CAMPUS_SPOT', 'REMOTE'])
    .optional(),
  status: z
    .enum(['ACTIVE', 'BUSY', 'PAUSED', 'SOLD_OUT', 'OPEN'])
    .optional(),
  imageUrl: z.string().max(1000).optional(),
  images: z.array(z.string().max(1000)).max(10).optional(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
});

export const toggleStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'BUSY', 'PAUSED', 'SOLD_OUT', 'OPEN']),
});

export const createReviewSchema = z.object({
  rating: z.coerce
    .number()
    .int('Rating must be a whole number between 1 and 5')
    .min(1, 'Rating must be at least 1 star')
    .max(5, 'Rating cannot exceed 5 stars'),
  comment: z
    .string()
    .min(3, 'Review comment must be at least 3 characters')
    .max(1000, 'Review comment cannot exceed 1000 characters')
    .trim(),
});

export const hustleQuerySchema = z.object({
  campus: z.string().optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  search: z.string().optional(),
  sellerId: z.string().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z
    .enum(['recommended', 'price_asc', 'price_desc', 'rating_desc', 'reviews_desc', 'newest'])
    .optional()
    .default('recommended'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
