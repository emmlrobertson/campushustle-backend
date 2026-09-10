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
      seller_id TEXT,
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
      delivery_mode TEXT DEFAULT 'to_client',
      status TEXT DEFAULT 'OPEN',
      FOREIGN KEY (campus_id) REFERENCES campuses(id),
      FOREIGN KEY (seller_id) REFERENCES users(id)
    );
  `);

  // Migration: Ensure seller_id, delivery_mode, and status columns exist on existing installations
  const tableInfo = await db.all("PRAGMA table_info(hustles)");
  const hasSellerId = tableInfo.some((col: any) => col.name === 'seller_id');
  if (!hasSellerId) {
    console.log('🔄 Migrating Database: Adding seller_id column to hustles table...');
    await db.exec('ALTER TABLE hustles ADD COLUMN seller_id TEXT;');
  }

  const hasDeliveryMode = tableInfo.some((col: any) => col.name === 'delivery_mode');
  if (!hasDeliveryMode) {
    console.log('🔄 Migrating Database: Adding delivery_mode column to hustles table...');
    await db.exec("ALTER TABLE hustles ADD COLUMN delivery_mode TEXT DEFAULT 'to_client';");
  }

  const hasStatus = tableInfo.some((col: any) => col.name === 'status');
  if (!hasStatus) {
    console.log('🔄 Migrating Database: Adding status column to hustles table...');
    await db.exec("ALTER TABLE hustles ADD COLUMN status TEXT DEFAULT 'OPEN';");
  }

  // 4. Reviews Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      hustle_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewer_name TEXT NOT NULL,
      reviewer_program TEXT NOT NULL,
      rating REAL NOT NULL,
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (hustle_id) REFERENCES hustles(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id)
    );
  `);

  // 5. Transactions / MoMo Payments Table with Escrow Protection
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
      escrow_status TEXT DEFAULT 'held',
      meetup_spot TEXT,
      FOREIGN KEY (hustle_id) REFERENCES hustles(id)
    );
  `);

  // Migration: Ensure escrow_status and meetup_spot columns exist on existing transactions table
  const txTableInfo = await db.all("PRAGMA table_info(transactions)");
  const hasEscrowStatus = txTableInfo.some((col: any) => col.name === 'escrow_status');
  if (!hasEscrowStatus) {
    console.log('🔄 Migrating Database: Adding escrow_status column to transactions table...');
    await db.exec("ALTER TABLE transactions ADD COLUMN escrow_status TEXT DEFAULT 'held';");
  }

  const hasMeetupSpot = txTableInfo.some((col: any) => col.name === 'meetup_spot');
  if (!hasMeetupSpot) {
    console.log('🔄 Migrating Database: Adding meetup_spot column to transactions table...');
    await db.exec('ALTER TABLE transactions ADD COLUMN meetup_spot TEXT;');
  }

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
