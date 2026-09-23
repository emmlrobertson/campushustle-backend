import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { PrismaClient, HustleStatus, DeliveryMode, PriceType, PaymentMethod } from '@prisma/client';

const prisma = new PrismaClient();

export async function migrateSqliteToPostgres() {
  console.log('🔄 Starting SQLite -> PostgreSQL Data Migration...');

  const sqlitePath = path.resolve(__dirname, '../../campushustle.sqlite');
  const db = await open({
    filename: sqlitePath,
    driver: sqlite3.Database,
  });

  // 1. Fetch legacy campuses and map to PostgreSQL University IDs
  const legacyCampuses = await db.all('SELECT * FROM campuses');
  const universityMap = new Map<string, string>(); // code -> id

  for (const c of legacyCampuses) {
    const code = c.code.toUpperCase();
    const uni = await prisma.university.findUnique({ where: { code } });
    if (uni) {
      universityMap.set(c.id.toLowerCase(), uni.id);
      universityMap.set(code.toLowerCase(), uni.id);
    }
  }

  // Fallback to KNUST if unmapped
  const knustUni = await prisma.university.findUnique({ where: { code: 'KNUST' } });
  const defaultUniId = knustUni?.id || '';

  // 2. Migrate Users
  const legacyUsers = await db.all('SELECT * FROM users');
  console.log(`👤 Migrating ${legacyUsers.length} Users...`);

  for (const u of legacyUsers) {
    const uniId = universityMap.get((u.campus_id || 'knust').toLowerCase()) || defaultUniId;
    if (!uniId) continue;

    await prisma.user.upsert({
      where: { email: u.email.trim().toLowerCase() },
      update: {
        name: u.name,
        passwordHash: u.password_hash,
        program: u.program || 'Student',
        hostelLocation: u.hostel_location || 'Campus Area',
        phoneNumber: u.whats_app_number || null,
        phoneVerified: Boolean(u.phone_verified),
        universityId: uniId,
      },
      create: {
        id: u.id,
        email: u.email.trim().toLowerCase(),
        name: u.name,
        passwordHash: u.password_hash,
        program: u.program || 'Student',
        hostelLocation: u.hostel_location || 'Campus Area',
        phoneNumber: u.whats_app_number || null,
        phoneVerified: Boolean(u.phone_verified),
        universityId: uniId,
        createdAt: u.created_at ? new Date(u.created_at) : new Date(),
      },
    });
  }

  // 3. Migrate Hustles & Create SellerProfiles
  const legacyHustles = await db.all('SELECT * FROM hustles');
  console.log(`🛍️ Migrating ${legacyHustles.length} Hustles & Creating SellerProfiles...`);

  const categoryCache = new Map<string, string>(); // slug -> id
  const allCategories = await prisma.category.findMany();
  allCategories.forEach((cat: { slug: string; id: string }) => categoryCache.set(cat.slug, cat.id));
  const defaultCategoryId = allCategories[0]?.id || '';

  for (const h of legacyHustles) {
    // Determine seller user
    let sellerUserId = h.seller_id;
    if (!sellerUserId) {
      // Look up user by name or fallback to first user
      const foundUser = await prisma.user.findFirst();
      if (!foundUser) continue;
      sellerUserId = foundUser.id;
    } else {
      const userExists = await prisma.user.findUnique({ where: { id: sellerUserId } });
      if (!userExists) {
        const foundUser = await prisma.user.findFirst();
        if (!foundUser) continue;
        sellerUserId = foundUser.id;
      }
    }

    // Ensure SellerProfile exists for this user
    let sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId: sellerUserId },
    });

    if (!sellerProfile) {
      sellerProfile = await prisma.sellerProfile.create({
        data: {
          userId: sellerUserId,
          businessName: h.seller_name || null,
          payoutMomoNumber: h.whats_app_number || '0241234567',
          payoutMomoNetwork: PaymentMethod.MTN_MOMO,
          isVerifiedSeller: true,
        },
      });
    }

    const uniId = universityMap.get((h.campus_id || 'knust').toLowerCase()) || defaultUniId;
    const catId = categoryCache.get(h.category) || defaultCategoryId;

    // Delivery mode mapping
    let deliveryMode: DeliveryMode = DeliveryMode.TO_CLIENT;
    if (h.delivery_mode === 'at_seller') deliveryMode = DeliveryMode.AT_SELLER;
    else if (h.delivery_mode === 'campus_spot') deliveryMode = DeliveryMode.CAMPUS_SPOT;
    else if (h.delivery_mode === 'remote') deliveryMode = DeliveryMode.REMOTE;

    // Price type mapping
    let priceType: PriceType = PriceType.FLAT;
    if (h.price_type === 'starting_at') priceType = PriceType.STARTING_AT;
    else if (h.price_type === 'hourly') priceType = PriceType.HOURLY;

    // Status mapping
    const status: HustleStatus = h.status === 'BUSY' ? HustleStatus.BUSY : HustleStatus.ACTIVE;

    const tagsArray = h.tags ? h.tags.split(',').map((t: string) => t.trim()) : [];

    const hustle = await prisma.hustle.upsert({
      where: { id: h.id },
      update: {
        title: h.title,
        description: h.description,
        price: h.price,
        priceType,
        deliveryMode,
        status,
        hostelLocation: h.hostel_location,
        whatsAppContact: h.whats_app_number,
        ratingAverage: h.rating || 5.0,
        ratingCount: h.review_count || 1,
        isFeatured: Boolean(h.is_featured),
        tags: tagsArray,
        sellerProfileId: sellerProfile.id,
        universityId: uniId,
        categoryId: catId,
      },
      create: {
        id: h.id,
        title: h.title,
        description: h.description,
        price: h.price,
        priceType,
        deliveryMode,
        status,
        hostelLocation: h.hostel_location,
        whatsAppContact: h.whats_app_number,
        ratingAverage: h.rating || 5.0,
        ratingCount: h.review_count || 1,
        isFeatured: Boolean(h.is_featured),
        tags: tagsArray,
        sellerProfileId: sellerProfile.id,
        universityId: uniId,
        categoryId: catId,
        createdAt: h.created_at ? new Date(h.created_at) : new Date(),
      },
    });

    // Migrate image into HustleImage table
    if (h.image_url) {
      const existingImg = await prisma.hustleImage.findFirst({
        where: { hustleId: hustle.id, imageUrl: h.image_url },
      });
      if (!existingImg) {
        await prisma.hustleImage.create({
          data: {
            hustleId: hustle.id,
            imageUrl: h.image_url,
            sortOrder: 0,
          },
        });
      }
    }
  }

  console.log('✅ SQLite -> PostgreSQL Migration Finished Successfully!');
  await db.close();
}

if (require.main === module) {
  migrateSqliteToPostgres()
    .catch((e) => {
      console.error('❌ Data Migration Error:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
