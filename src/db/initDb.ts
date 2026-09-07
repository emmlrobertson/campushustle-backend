import { getDatabase } from './database';

export async function initializeDatabase() {
  const db = await getDatabase();

  console.log('📦 Initializing Database Tables...');

  // 1. Campuses Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS campuses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      city TEXT NOT NULL
    );
  `);

  // 2. Users Table with Password Hash
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      program TEXT NOT NULL,
      hostel_location TEXT NOT NULL,
      whats_app_number TEXT NOT NULL,
      campus_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (campus_id) REFERENCES campuses(id)
    );
  `);

  // 3. Hustles Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hustles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price REAL NOT NULL,
      price_type TEXT NOT NULL,
      category TEXT NOT NULL,
      hostel_location TEXT NOT NULL,
      seller_name TEXT NOT NULL,
      seller_program TEXT NOT NULL,
      whats_app_number TEXT NOT NULL,
      campus_id TEXT NOT NULL,
      rating REAL DEFAULT 5.0,
      review_count INTEGER DEFAULT 1,
      image_url TEXT NOT NULL,
      tags TEXT NOT NULL,
      is_featured INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (campus_id) REFERENCES campuses(id)
    );
  `);

  // 4. Transactions / MoMo Payments Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      hustle_id TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      seller_name TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      momo_number TEXT NOT NULL,
      status TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (hustle_id) REFERENCES hustles(id)
    );
  `);

  // Seed Campuses if empty
  const campusCount = await db.get('SELECT COUNT(*) as count FROM campuses');
  if (campusCount.count === 0) {
    console.log('🌱 Seeding Campuses (KNUST, UG Legon, UCC)...');
    await db.run(
      `INSERT INTO campuses (id, name, code, city) VALUES 
      ('knust', 'Kwame Nkrumah University of Science and Technology', 'KNUST', 'Kumasi'),
      ('ug_legon', 'University of Ghana', 'UG', 'Accra'),
      ('ucc', 'University of Cape Coast', 'UCC', 'Cape Coast')`
    );
  }

  // Seed KNUST Seed Hustles if empty
  const hustleCount = await db.get('SELECT COUNT(*) as count FROM hustles');
  if (hustleCount.count === 0) {
    console.log('🌱 Seeding KNUST Side-Hustles...');
    const seedHustles = [
      [
        'hst_01',
        'C++, Java & Data Structures Tutoring',
        'Struggling with C++ or Data Structures (CS 252)? I provide 1-on-1 tutoring sessions at CCB or online. Solved past questions & assignment guidance included!',
        45,
        'hourly',
        'tutoring',
        'Katanga (University Hall)',
        'Kofi Owusu',
        'Computer Engineering (Level 300)',
        '233241234567',
        'knust',
        4.9,
        28,
        'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80',
        'Programming,C++,Java,CS,Exams',
        1,
        '2026-09-01T10:00:00Z',
      ],
      [
        'hst_02',
        'Dorm Room iPhone Screen & Battery Repairs',
        'Broken iPhone screen or battery draining fast? I do genuine screen and battery replacements right in your hostel (Ayeduase/Brunei/Halls) within 30 minutes!',
        180,
        'starting_at',
        'tech_repair',
        'Ayeduase',
        'Emmanuel Addo',
        'Telecom Engineering (Level 400)',
        '233509876543',
        'knust',
        4.8,
        42,
        'https://images.unsplash.com/photo-1597740985671-2a8a3b80502e?auto=format&fit=crop&w=600&q=80',
        'iPhone,Screen Repair,Battery,Tech',
        1,
        '2026-09-02T14:30:00Z',
      ],
      [
        'hst_03',
        'Graduation & Birthday Photoshoots (Raw + Edits)',
        'Professional DSLR photography for matriculation, birthdays, and squad photoshoots around campus (Botanical Gardens, Great Hall, Queen’s). 15 edited photos delivered in 48hrs.',
        150,
        'flat',
        'photo_video',
        'Africa Hall',
        'Abena Serwaa',
        'Communication Design (Level 200)',
        '233543210987',
        'knust',
        5.0,
        19,
        'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=600&q=80',
        'Photography,Graduation,Portraits,Media',
        1,
        '2026-09-03T09:15:00Z',
      ],
      [
        'hst_04',
        'Late Night Fresh Pastries & Milkshake Delivery',
        'Studying late for mid-sem? We deliver hot meat pies, spring rolls, and cold choco milkshakes straight to your hostel door in Kotei, Ayeduase & Gaza till 1 AM!',
        25,
        'flat',
        'food_delivery',
        'Kotei',
        'Sena & Friends',
        'Food Science (Level 300)',
        '233271122334',
        'knust',
        4.7,
        56,
        'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80',
        'Food,Pastries,Late Night,Delivery',
        0,
        '2026-09-04T18:00:00Z',
      ],
    ];

    for (const h of seedHustles) {
      await db.run(
        `INSERT INTO hustles 
        (id, title, description, price, price_type, category, hostel_location, seller_name, seller_program, whats_app_number, campus_id, rating, review_count, image_url, tags, is_featured, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        h
      );
    }
  }

  console.log('✅ Database Initialization Complete!');
}
