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

  console.log('✅ Clean Database Initialization Complete (0 Sample Posts)!');
}
