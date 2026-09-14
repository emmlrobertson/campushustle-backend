import { prisma } from './prisma';

async function verifyPostgres() {
  console.log('🔍 Verifying PostgreSQL Database with Prisma...');

  const universities = await prisma.university.findMany({
    select: { code: true, name: true, city: true },
    orderBy: { code: 'asc' },
  });
  console.log('\n🏛️ Universities Seeded in PostgreSQL:');
  console.table(universities);

  const categories = await prisma.category.findMany({
    select: { slug: true, name: true, icon: true },
    orderBy: { sortOrder: 'asc' },
  });
  console.log('\n📂 Categories Seeded:');
  console.table(categories);

  const userCount = await prisma.user.count();
  const sellerCount = await prisma.sellerProfile.count();
  const hustleCount = await prisma.hustle.count();
  const imageCount = await prisma.hustleImage.count();

  console.log('\n📊 Database Row Counts:');
  console.table({
    Users: userCount,
    SellerProfiles: sellerCount,
    Hustles: hustleCount,
    HustleImages: imageCount,
    Universities: universities.length,
    Categories: categories.length,
  });

  console.log('\n✅ PostgreSQL & Prisma Setup 100% Operational!');
}

verifyPostgres()
  .catch((e) => {
    console.error('❌ Verification failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
