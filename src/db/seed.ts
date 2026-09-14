import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedDatabase() {
  console.log('🌱 Starting Database Seeding...');

  // 1. Seed Ghanaian Universities
  const universities = [
    {
      code: 'KNUST',
      name: 'Kwame Nkrumah University of Science and Technology',
      shortName: 'KNUST',
      city: 'Kumasi',
      allowedDomains: ['st.knust.edu.gh'],
      popularLocations: ['Ayeduase Central', 'Kotei', 'Brunei Complex', 'CCB', 'Gaza', 'Hall 7'],
    },
    {
      code: 'UG',
      name: 'University of Ghana',
      shortName: 'UG Legon',
      city: 'Accra',
      allowedDomains: ['st.ug.edu.gh'],
      popularLocations: ['Pentagon (Diaspora)', 'Bani Hall', 'TF Hostel', 'Night Market', 'Balme'],
    },
    {
      code: 'UCC',
      name: 'University of Cape Coast',
      shortName: 'UCC',
      city: 'Cape Coast',
      allowedDomains: ['stu.ucc.edu.gh'],
      popularLocations: ['Casely Hayford (Casford)', 'Valco', 'KNH', 'Amamoma', 'Science Quad'],
    },
    {
      code: 'UMAT',
      name: 'University of Mines and Technology',
      shortName: 'UMaT',
      city: 'Tarkwa',
      allowedDomains: ['st.umat.edu.gh'],
      popularLocations: ['Main Campus', 'Gold Hall', 'Chamber Hall', 'KT Hall'],
    },
    {
      code: 'UHAS',
      name: 'University of Health and Allied Sciences',
      shortName: 'UHAS',
      city: 'Ho',
      allowedDomains: ['st.uhas.edu.gh'],
      popularLocations: ['Main Campus Sokode', 'Trafalgar', 'Dave', 'Adaklu'],
    },
  ];

  for (const uni of universities) {
    await prisma.university.upsert({
      where: { code: uni.code },
      update: {
        name: uni.name,
        shortName: uni.shortName,
        city: uni.city,
        allowedDomains: uni.allowedDomains,
        popularLocations: uni.popularLocations,
      },
      create: uni,
    });
  }
  console.log(`✅ Seeded ${universities.length} Ghanaian Universities.`);

  // 2. Seed Default Hustle Categories
  const categories = [
    { slug: 'tutoring', name: 'Academics & Tutoring', icon: '📚', sortOrder: 1 },
    { slug: 'tech_repair', name: 'Tech & Gadget Repairs', icon: '💻', sortOrder: 2 },
    { slug: 'beauty_grooming', name: 'Beauty, Hair & Grooming', icon: '💅', sortOrder: 3 },
    { slug: 'fashion_beauty', name: 'Beauty, Hair & Grooming', icon: '💅', sortOrder: 3 },
    { slug: 'photography', name: 'Photography & Media', icon: '📸', sortOrder: 4 },
    { slug: 'photo_video', name: 'Photography & Media', icon: '📸', sortOrder: 4 },
    { slug: 'food_snacks', name: 'Campus Food & Baking', icon: '🍕', sortOrder: 5 },
    { slug: 'food_delivery', name: 'Campus Food & Baking', icon: '🍕', sortOrder: 5 },
    { slug: 'laundry_cleaning', name: 'Laundry & Errand Runners', icon: '🧺', sortOrder: 6 },
    { slug: 'laundry_errands', name: 'Laundry & Errand Runners', icon: '🧺', sortOrder: 6 },
    { slug: 'fashion_thrift', name: 'Fashion & Thrift Fits', icon: '👗', sortOrder: 7 },
    { slug: 'custom', name: 'Custom Crafts & Services', icon: '🎨', sortOrder: 8 },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        icon: cat.icon,
        sortOrder: cat.sortOrder,
      },
      create: cat,
    });
  }
  console.log(`✅ Seeded ${categories.length} Hustle Categories.`);
  console.log('🎉 Seeding Complete!');
}

if (require.main === module) {
  seedDatabase()
    .catch((e) => {
      console.error('❌ Seeding Error:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
