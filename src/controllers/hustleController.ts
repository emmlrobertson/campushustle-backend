import { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import {
  createHustleSchema,
  updateHustleSchema,
  toggleStatusSchema,
  createReviewSchema,
  hustleQuerySchema,
} from '../validators/hustleValidators';
import { HustleStatus, PriceType, DeliveryMode, SubOrderStatus } from '@prisma/client';
import { storageService } from '../services/storageService';

// ============================================================================
// HELPER: Format Prisma Hustle to Expo Frontend Compatible Object
// ============================================================================
function sanitizeImageUrl(rawUrl?: string, categorySlug?: string, title?: string): string {
  if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) && !rawUrl.includes('/uploads/')) {
    return rawUrl;
  }
  const t = (title || '').toLowerCase();
  if (t.includes('photo') || t.includes('cam') || t.includes('shoot') || t.includes('video')) {
    return 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=80';
  }
  if (t.includes('animat') || t.includes('code') || t.includes('tech') || t.includes('laptop') || t.includes('phone')) {
    return 'https://images.unsplash.com/photo-1597740985671-2a8a3b80502e?auto=format&fit=crop&w=800&q=80';
  }
  if (t.includes('food') || t.includes('cook') || t.includes('bake') || t.includes('snack') || t.includes('rice')) {
    return 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80';
  }
  if (t.includes('beauty') || t.includes('hair') || t.includes('braid') || t.includes('nail') || t.includes('wig')) {
    return 'https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=800&q=80';
  }
  if (t.includes('clean') || t.includes('laundry') || t.includes('wash')) {
    return 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?auto=format&fit=crop&w=800&q=80';
  }
  if (categorySlug === 'tech_repair') {
    return 'https://images.unsplash.com/photo-1597740985671-2a8a3b80502e?auto=format&fit=crop&w=800&q=80';
  }
  if (categorySlug === 'photo_video') {
    return 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=80';
  }
  if (categorySlug === 'food_delivery') {
    return 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80';
  }
  if (categorySlug === 'fashion_beauty') {
    return 'https://images.unsplash.com/photo-1560869713-7d0a29430803?auto=format&fit=crop&w=800&q=80';
  }
  if (categorySlug === 'laundry_errands') {
    return 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?auto=format&fit=crop&w=800&q=80';
  }
  return 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80';
}

function formatHustleResponse(hustle: any) {
  const catSlug = hustle.category?.slug || hustle.categoryId;
  const rawImages = hustle.images && hustle.images.length > 0
    ? hustle.images.map((img: any) => img.imageUrl)
    : [];

  const images = rawImages.length > 0
    ? rawImages.map((u: string) => sanitizeImageUrl(u, catSlug, hustle.title))
    : [sanitizeImageUrl(undefined, catSlug, hustle.title)];

  const primaryImage = images[0];

  // Map Prisma PriceType enum to frontend lowercase string
  let priceTypeString = 'flat';
  if (hustle.priceType === 'HOURLY') priceTypeString = 'hourly';
  else if (hustle.priceType === 'STARTING_AT') priceTypeString = 'starting_at';
  else if (hustle.priceType === 'NEGOTIABLE') priceTypeString = 'negotiable';

  // Map Prisma DeliveryMode enum to frontend lowercase string
  let deliveryModeString = 'to_client';
  if (hustle.deliveryMode === 'AT_SELLER') deliveryModeString = 'at_seller';
  else if (hustle.deliveryMode === 'CAMPUS_SPOT') deliveryModeString = 'campus_spot';
  else if (hustle.deliveryMode === 'REMOTE') deliveryModeString = 'remote';

  // Map Prisma status to frontend 'OPEN' | 'BUSY'
  const frontendStatus = hustle.status === 'BUSY' ? 'BUSY' : 'OPEN';

  return {
    id: hustle.id,
    title: hustle.title,
    description: hustle.description,
    price: Number(hustle.price),
    priceType: priceTypeString,
    category: hustle.category?.slug || hustle.categoryId,
    categoryName: hustle.category?.name,
    hostelLocation: hustle.hostelLocation,
    sellerId: hustle.sellerProfile?.userId || '',
    sellerName: hustle.sellerProfile?.businessName || hustle.sellerProfile?.user?.name || 'Verified Student',
    sellerProgram: hustle.sellerProfile?.user?.program || 'Student',
    whatsAppNumber: hustle.whatsAppContact,
    campus: (hustle.university?.code || 'KNUST').toLowerCase(),
    universityName: hustle.university?.name,
    rating: Number(hustle.ratingAverage),
    reviewCount: hustle.ratingCount,
    imageUrl: primaryImage,
    images,
    tags: hustle.tags || [],
    isFeatured: Boolean(hustle.isFeatured),
    deliveryMode: deliveryModeString,
    status: frontendStatus,
    createdAt: hustle.createdAt instanceof Date ? hustle.createdAt.toISOString() : hustle.createdAt,
    updatedAt: hustle.updatedAt instanceof Date ? hustle.updatedAt.toISOString() : hustle.updatedAt,
  };
}

// Map frontend price type to Prisma PriceType enum
function mapPriceType(val?: string): PriceType {
  if (!val) return PriceType.FLAT;
  const upper = val.toUpperCase();
  if (upper === 'HOURLY') return PriceType.HOURLY;
  if (upper === 'STARTING_AT') return PriceType.STARTING_AT;
  if (upper === 'NEGOTIABLE') return PriceType.NEGOTIABLE;
  return PriceType.FLAT;
}

// Map frontend delivery mode to Prisma DeliveryMode enum
function mapDeliveryMode(val?: string): DeliveryMode {
  if (!val) return DeliveryMode.TO_CLIENT;
  const upper = val.toUpperCase();
  if (upper === 'AT_SELLER') return DeliveryMode.AT_SELLER;
  if (upper === 'CAMPUS_SPOT') return DeliveryMode.CAMPUS_SPOT;
  if (upper === 'REMOTE') return DeliveryMode.REMOTE;
  return DeliveryMode.TO_CLIENT;
}

// Map frontend status string to Prisma HustleStatus enum
function mapHustleStatus(val?: string): HustleStatus {
  if (!val) return HustleStatus.ACTIVE;
  const upper = val.toUpperCase();
  if (upper === 'BUSY') return HustleStatus.BUSY;
  if (upper === 'PAUSED') return HustleStatus.PAUSED;
  if (upper === 'SOLD_OUT') return HustleStatus.SOLD_OUT;
  return HustleStatus.ACTIVE;
}

// ============================================================================
// 1. GET ALL HUSTLES (With Filtering, Search, Sorting, and Pagination)
// ============================================================================
export const getAllHustles = async (req: Request, res: Response) => {
  try {
    const parseResult = hustleQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: parseResult.error.flatten(),
      });
    }

    const {
      campus,
      category,
      location,
      search,
      sellerId,
      minPrice,
      maxPrice,
      sort,
      page = 1,
      limit = 20,
    } = parseResult.data;

    const where: any = {
      status: { in: [HustleStatus.ACTIVE, HustleStatus.BUSY] },
    };

    // 1. Campus / University Filter
    if (campus && campus !== 'all') {
      const cleanCampus = campus.trim().toUpperCase();
      const uni = await prisma.university.findFirst({
        where: {
          OR: [
            { code: cleanCampus },
            { code: cleanCampus === 'UG_LEGON' ? 'UG' : cleanCampus },
            { id: campus },
          ],
        },
      });
      if (uni) {
        where.universityId = uni.id;
      }
    }

    // 2. Category Filter
    if (category && category !== 'all') {
      const cat = await prisma.category.findFirst({
        where: {
          OR: [{ slug: category.trim() }, { id: category.trim() }],
        },
      });
      if (cat) {
        where.categoryId = cat.id;
      }
    }

    // 3. Hostel Location Filter
    if (location && location !== 'All Locations') {
      where.hostelLocation = {
        contains: location.trim(),
        mode: 'insensitive',
      };
    }

    // 4. Seller ID Filter
    if (sellerId) {
      where.sellerProfile = {
        userId: sellerId,
      };
    }

    // 5. Price Range Filter
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    // 6. Search Filter
    if (search && search.trim()) {
      const searchTerm = search.trim();
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { hostelLocation: { contains: searchTerm, mode: 'insensitive' } },
        { tags: { has: searchTerm } },
        {
          sellerProfile: {
            OR: [
              { businessName: { contains: searchTerm, mode: 'insensitive' } },
              { user: { name: { contains: searchTerm, mode: 'insensitive' } } },
            ],
          },
        },
      ];
    }

    // 7. Sorting Order
    let orderBy: any[] = [];
    switch (sort) {
      case 'price_asc':
        orderBy = [{ price: 'asc' }, { createdAt: 'desc' }];
        break;
      case 'price_desc':
        orderBy = [{ price: 'desc' }, { createdAt: 'desc' }];
        break;
      case 'rating_desc':
        orderBy = [{ ratingAverage: 'desc' }, { ratingCount: 'desc' }];
        break;
      case 'reviews_desc':
        orderBy = [{ ratingCount: 'desc' }, { ratingAverage: 'desc' }];
        break;
      case 'newest':
        orderBy = [{ createdAt: 'desc' }];
        break;
      case 'recommended':
      default:
        orderBy = [
          { isFeatured: 'desc' },
          { ratingAverage: 'desc' },
          { ratingCount: 'desc' },
          { createdAt: 'desc' },
        ];
        break;
    }

    // 8. Execute Paginated Prisma Query
    const skip = (page - 1) * limit;
    const take = limit;

    const [total, rows] = await prisma.$transaction([
      prisma.hustle.count({ where }),
      prisma.hustle.findMany({
        where,
        include: {
          university: true,
          category: true,
          sellerProfile: {
            include: { user: true },
          },
          images: {
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    const hustles = rows.map(formatHustleResponse);

    res.json({
      success: true,
      count: hustles.length,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      hasMore: page * limit < total,
      data: hustles,
    });
  } catch (error: any) {
    console.error('getAllHustles error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 2. GET SINGLE HUSTLE BY ID
// ============================================================================
export const getHustleById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const hustle = await prisma.hustle.findUnique({
      where: { id },
      include: {
        university: true,
        category: true,
        sellerProfile: {
          include: { user: true },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        reviews: {
          include: { reviewer: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!hustle) {
      return res.status(404).json({ success: false, error: 'Hustle listing not found.' });
    }

    res.json({
      success: true,
      data: formatHustleResponse(hustle),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 3. GET MY HUSTLES (Authenticated Student Listings)
// ============================================================================
export const getMyHustles = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const rows = await prisma.hustle.findMany({
      where: {
        sellerProfile: { userId },
      },
      include: {
        university: true,
        category: true,
        sellerProfile: {
          include: { user: true },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hustles = rows.map(formatHustleResponse);

    res.json({
      success: true,
      count: hustles.length,
      data: hustles,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 4. CREATE HUSTLE (Strict Ownership, Token University & Zod Validation)
// ============================================================================
export const createHustle = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in with your student account.',
      });
    }

    // 1. Validate request body with Zod
    const validation = createHustleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid listing data',
        details: validation.error.flatten(),
      });
    }

    const {
      title,
      description,
      price,
      priceType,
      category,
      hostelLocation,
      whatsAppNumber,
      deliveryMode,
      status,
      imageUrl,
      images = [],
      tags = [],
    } = validation.data;

    // 2. Derive student identity and university strictly from authenticated user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { university: true, sellerProfile: true },
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Student account not found.' });
    }

    // 3. Ensure SellerProfile exists (Buyer + Seller dual-role design)
    let sellerProfile = user.sellerProfile;
    if (!sellerProfile) {
      sellerProfile = await prisma.sellerProfile.create({
        data: {
          userId: user.id,
          businessName: user.name,
          payoutMomoNumber: whatsAppNumber || user.phoneNumber || '0240000000',
          isVerifiedSeller: user.phoneVerified,
        },
      });
    }

    // 4. Resolve Category
    const categoryRecord = await prisma.category.findFirst({
      where: {
        OR: [{ slug: category.trim() }, { id: category.trim() }],
      },
    });
    const categoryId = categoryRecord?.id || (await prisma.category.findFirst())?.id || '';

    // 5. Prepare images (support single imageUrl or images array)
    const imageList: string[] = [];
    if (images && images.length > 0) {
      imageList.push(...images);
    } else if (imageUrl) {
      imageList.push(imageUrl);
    } else {
      imageList.push('https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80');
    }

    const tagsArray = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map((t) => t.trim()) : []);
    const id = `hst_${Date.now()}`;
    const contactPhone = whatsAppNumber || user.phoneNumber || '';

    // 6. Security Enforcement:
    // - Seller identity is strictly sellerProfile.id (derived from token userId).
    // - University is strictly user.universityId (derived from verified university).
    // - Rating count is strictly 0 and rating average is 5.0 (unmanipulatable by client).
    const createdHustle = await prisma.hustle.create({
      data: {
        id,
        title,
        description,
        price,
        priceType: mapPriceType(priceType),
        deliveryMode: mapDeliveryMode(deliveryMode),
        status: mapHustleStatus(status),
        hostelLocation: hostelLocation || user.hostelLocation,
        whatsAppContact: contactPhone,
        ratingAverage: 5.0,
        ratingCount: 0,
        tags: tagsArray,
        sellerProfileId: sellerProfile.id,
        universityId: user.universityId,
        categoryId,
        images: {
          create: imageList.map((url, idx) => ({
            imageUrl: url,
            sortOrder: idx,
          })),
        },
      },
      include: {
        university: true,
        category: true,
        sellerProfile: { include: { user: true } },
        images: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Hustle created successfully!',
      data: formatHustleResponse(createdHustle),
    });
  } catch (error: any) {
    console.error('Create Hustle Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 5. UPDATE HUSTLE (Strict Ownership & Zod Validation)
// ============================================================================
export const updateHustle = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const validation = updateHustleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid update data',
        details: validation.error.flatten(),
      });
    }

    // 1. Fetch existing hustle and verify seller ownership
    const existing = await prisma.hustle.findUnique({
      where: { id },
      include: { sellerProfile: true },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Hustle not found' });
    }

    if (existing.sellerProfile.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You can only update your own hustle listings.',
      });
    }

    const data: any = {};
    const val = validation.data;

    if (val.title !== undefined) data.title = val.title;
    if (val.description !== undefined) data.description = val.description;
    if (val.price !== undefined) data.price = val.price;
    if (val.priceType !== undefined) data.priceType = mapPriceType(val.priceType);
    if (val.deliveryMode !== undefined) data.deliveryMode = mapDeliveryMode(val.deliveryMode);
    if (val.status !== undefined) data.status = mapHustleStatus(val.status);
    if (val.hostelLocation !== undefined) data.hostelLocation = val.hostelLocation;
    if (val.whatsAppNumber !== undefined) data.whatsAppContact = val.whatsAppNumber;

    if (val.tags !== undefined) {
      data.tags = Array.isArray(val.tags)
        ? val.tags
        : val.tags.split(',').map((t) => t.trim());
    }

    if (val.category !== undefined) {
      const cat = await prisma.category.findFirst({
        where: {
          OR: [{ slug: val.category.trim() }, { id: val.category.trim() }],
        },
      });
      if (cat) data.categoryId = cat.id;
    }

    // Handle images update if provided
    if (val.images && val.images.length > 0) {
      await prisma.hustleImage.deleteMany({ where: { hustleId: id } });
      data.images = {
        create: val.images.map((url, idx) => ({
          imageUrl: url,
          sortOrder: idx,
        })),
      };
    } else if (val.imageUrl) {
      await prisma.hustleImage.deleteMany({ where: { hustleId: id } });
      data.images = {
        create: [{ imageUrl: val.imageUrl, sortOrder: 0 }],
      };
    }

    // 2. Execute update in PostgreSQL
    const updated = await prisma.hustle.update({
      where: { id },
      data,
      include: {
        university: true,
        category: true,
        sellerProfile: { include: { user: true } },
        images: true,
      },
    });

    res.json({
      success: true,
      message: 'Hustle updated successfully',
      data: formatHustleResponse(updated),
    });
  } catch (error: any) {
    console.error('Update Hustle Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 6. DELETE HUSTLE (Strict Ownership Enforcement)
// ============================================================================
export const deleteHustle = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const userRole = authReq.user?.role;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const existing = await prisma.hustle.findUnique({
      where: { id },
      include: { sellerProfile: true, images: true },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Hustle not found' });
    }

    // Check ownership: student must own listing unless they are an ADMIN/MODERATOR
    if (existing.sellerProfile.userId !== userId && userRole !== 'ADMIN' && userRole !== 'MODERATOR') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You can only delete your own listings.',
      });
    }

    // Clean up storage assets
    if (existing.images && existing.images.length > 0) {
      for (const img of existing.images) {
        if (img.publicId) {
          await storageService.deleteImage(img.publicId).catch(() => {});
        }
      }
    }

    // Delete in PostgreSQL
    await prisma.hustle.delete({ where: { id } });

    res.json({ success: true, message: 'Hustle deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 7. TOGGLE HUSTLE STATUS (Active / Busy / Paused)
// ============================================================================
export const toggleHustleStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const validation = toggleStatusSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ success: false, error: 'Invalid status value' });
    }

    const existing = await prisma.hustle.findUnique({
      where: { id },
      include: { sellerProfile: true },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Hustle not found' });
    }

    if (existing.sellerProfile.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only update your own hustle.' });
    }

    const targetStatus = mapHustleStatus(validation.data.status);
    const updated = await prisma.hustle.update({
      where: { id },
      data: { status: targetStatus },
    });

    const frontendStatus = updated.status === 'BUSY' ? 'BUSY' : 'OPEN';

    res.json({
      success: true,
      message: `Status updated to ${frontendStatus}`,
      status: frontendStatus,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 8. GET HUSTLE REVIEWS
// ============================================================================
export const getHustleReviews = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const reviews = await prisma.review.findMany({
      where: { hustleId: id },
      include: {
        reviewer: {
          select: { id: true, name: true, program: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      count: reviews.length,
      data: reviews.map((r) => ({
        id: r.id,
        hustleId: r.hustleId,
        reviewerId: r.reviewerId,
        reviewerName: r.reviewer?.name || 'Verified Student',
        reviewerProgram: r.reviewer?.program || 'Student',
        rating: r.rating,
        comment: r.comment,
        isVerifiedPurchase: Boolean(r.orderItemId),
        orderItemId: r.orderItemId,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 9. CREATE HUSTLE REVIEW (Self-Review Protection & Atomic Rating Calculation)
// ============================================================================
export const createHustleReview = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const reviewerId = authReq.user?.id;

    if (!reviewerId) {
      return res.status(401).json({ success: false, error: 'Student login required to leave a review.' });
    }

    const validation = createReviewSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a star rating (1-5) and review comment.',
        details: validation.error.flatten(),
      });
    }

    const { rating, comment } = validation.data;

    // 1. Verify Hustle Existence & Seller Ownership
    const existingHustle = await prisma.hustle.findUnique({
      where: { id },
      include: { sellerProfile: true },
    });

    if (!existingHustle) {
      return res.status(404).json({ success: false, error: 'Hustle listing not found.' });
    }

    // 2. Business Rule: Students cannot review their own hustle
    if (existingHustle.sellerProfile.userId === reviewerId) {
      return res.status(400).json({
        success: false,
        error: 'You cannot review your own hustle listing.',
      });
    }

    // 3. Verified Purchase Rule: Require a completed OrderItem for this hustle
    const completedOrderItem = await prisma.orderItem.findFirst({
      where: {
        hustleId: id,
        subOrder: {
          order: { buyerId: reviewerId },
          status: { in: [SubOrderStatus.COMPLETED, SubOrderStatus.DELIVERED] },
        },
        review: null,
      },
    });

    if (!completedOrderItem) {
      return res.status(403).json({
        success: false,
        error: 'Only verified student buyers who have completed an order for this hustle can submit a review.',
      });
    }

    // 4. Atomically create review with orderItemId link and calculate new rating average
    const reviewer = await prisma.user.findUnique({ where: { id: reviewerId } });

    const result = await prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          hustleId: id,
          reviewerId,
          orderItemId: completedOrderItem.id,
          rating,
          comment,
        },
      });

      const stats = await tx.review.aggregate({
        where: { hustleId: id },
        _avg: { rating: true },
        _count: { id: true },
      });

      const calculatedRating = Math.round(((stats._avg.rating || rating) * 10)) / 10;
      const reviewCount = stats._count.id;

      await tx.hustle.update({
        where: { id },
        data: {
          ratingAverage: calculatedRating,
          ratingCount: reviewCount,
        },
      });

      return { review, calculatedRating, reviewCount };
    });

    res.status(201).json({
      success: true,
      message: 'Verified review posted successfully!',
      data: {
        id: result.review.id,
        hustleId: id,
        reviewerName: reviewer?.name || 'Verified Student',
        reviewerProgram: reviewer?.program || 'Student',
        rating,
        comment,
        isVerifiedPurchase: true,
        orderItemId: completedOrderItem.id,
        createdAt: result.review.createdAt.toISOString(),
      },
      updatedHustle: {
        rating: result.calculatedRating,
        reviewCount: result.reviewCount,
      },
    });
  } catch (error: any) {
    console.error('Create Review Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================================
// 10. UPLOAD HUSTLE IMAGE (Pre-upload for new listing creation)
// ============================================================================
export const uploadHustleImageHandler = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: "No image file provided. Please attach an image in the 'image' form field.",
      });
    }

    const uploadResult = await storageService.uploadImage(req.file.buffer, req.file.mimetype);

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      data: uploadResult,
    });
  } catch (error: any) {
    console.error('Image Upload Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Image upload failed' });
  }
};

// ============================================================================
// 11. UPLOAD IMAGE FOR EXISTING HUSTLE (With Seller Ownership Verification)
// ============================================================================
export const uploadHustleImagesForListingHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: "No image file provided. Please attach an image in the 'image' form field.",
      });
    }

    // 1. Verify hustle existence & seller ownership
    const hustle = await prisma.hustle.findUnique({
      where: { id },
      include: { sellerProfile: true },
    });

    if (!hustle) {
      return res.status(404).json({ success: false, error: 'Hustle not found' });
    }

    if (hustle.sellerProfile.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You can only upload images to your own listings.',
      });
    }

    // 2. Upload to storage
    const uploadResult = await storageService.uploadImage(req.file.buffer, req.file.mimetype);

    // 3. Save to database with automatic orphan cleanup on failure
    try {
      const createdImage = await prisma.hustleImage.create({
        data: {
          hustleId: id,
          imageUrl: uploadResult.imageUrl,
          thumbnailUrl: uploadResult.thumbnailUrl,
          publicId: uploadResult.publicId,
          sortOrder: 0,
        },
      });

      res.status(201).json({
        success: true,
        message: 'Image added to hustle successfully',
        data: createdImage,
      });
    } catch (dbError: any) {
      // Cleanup uploaded asset to prevent orphaned files
      await storageService.deleteImage(uploadResult.publicId).catch(() => {});
      throw dbError;
    }
  } catch (error: any) {
    console.error('Hustle Image Upload Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to upload image' });
  }
};

// ============================================================================
// 12. FAVORITES: TOGGLE FAVORITE (PostgreSQL Source of Truth)
// ============================================================================
export const toggleFavoriteHustle = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required to favorite listings.' });
    }

    const hustle = await prisma.hustle.findUnique({ where: { id } });
    if (!hustle) {
      return res.status(404).json({ success: false, error: 'Hustle not found.' });
    }

    const existing = await prisma.favorite.findUnique({
      where: {
        userId_hustleId: {
          userId,
          hustleId: id,
        },
      },
    });

    if (existing) {
      await prisma.favorite.delete({
        where: { id: existing.id },
      });
      return res.json({
        success: true,
        isFavorite: false,
        message: 'Removed from saved hustles.',
      });
    } else {
      await prisma.favorite.create({
        data: {
          userId,
          hustleId: id,
        },
      });
      return res.json({
        success: true,
        isFavorite: true,
        message: 'Saved to your favorites!',
      });
    }
  } catch (error: any) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update favorite.' });
  }
};

// ============================================================================
// 13. FAVORITES: GET MY FAVORITES
// ============================================================================
export const getMyFavoriteHustles = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required to view favorites.' });
    }

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: {
        hustle: {
          include: {
            university: true,
            category: true,
            sellerProfile: { include: { user: true } },
            images: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const favoriteIds = favorites.map((f) => f.hustleId);
    const favoriteHustles = favorites
      .filter((f) => f.hustle !== null)
      .map((f) => formatHustleResponse(f.hustle));

    res.json({
      success: true,
      count: favorites.length,
      favoriteIds,
      data: favoriteHustles,
    });
  } catch (error: any) {
    console.error('Get my favorites error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch favorites.' });
  }
};

