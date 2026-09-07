import { Request, Response } from 'express';
import { getDatabase } from '../db/database';

export const getAllHustles = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { campus = 'knust', category, location, search } = req.query;

    let query = 'SELECT * FROM hustles WHERE campus_id = ?';
    const params: any[] = [campus];

    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }

    if (location && location !== 'All Locations') {
      query += ' AND LOWER(hostel_location) LIKE ?';
      params.push(`%${(location as string).toLowerCase()}%`);
    }

    if (search) {
      const searchPattern = `%${(search as string).toLowerCase()}%`;
      query += ` AND (
        LOWER(title) LIKE ? OR 
        LOWER(description) LIKE ? OR 
        LOWER(seller_name) LIKE ? OR 
        LOWER(tags) LIKE ? OR 
        LOWER(hostel_location) LIKE ?
      )`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += ' ORDER BY is_featured DESC, created_at DESC';

    const rows = await db.all(query, params);

    // Format DB rows into clean JSON
    const hustles = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      price: r.price,
      priceType: r.price_type,
      category: r.category,
      hostelLocation: r.hostel_location,
      sellerName: r.seller_name,
      sellerProgram: r.seller_program,
      whatsAppNumber: r.whats_app_number,
      campus: r.campus_id,
      rating: r.rating,
      reviewCount: r.review_count,
      imageUrl: r.image_url,
      tags: r.tags ? r.tags.split(',') : [],
      isFeatured: Boolean(r.is_featured),
      createdAt: r.created_at,
    }));

    res.json({
      success: true,
      count: hustles.length,
      data: hustles,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getHustleById = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { id } = req.params;

    const r = await db.get('SELECT * FROM hustles WHERE id = ?', [id]);

    if (!r) {
      return res.status(404).json({ success: false, error: 'Hustle not found' });
    }

    const hustle = {
      id: r.id,
      title: r.title,
      description: r.description,
      price: r.price,
      priceType: r.price_type,
      category: r.category,
      hostelLocation: r.hostel_location,
      sellerName: r.seller_name,
      sellerProgram: r.seller_program,
      whatsAppNumber: r.whats_app_number,
      campus: r.campus_id,
      rating: r.rating,
      reviewCount: r.review_count,
      imageUrl: r.image_url,
      tags: r.tags ? r.tags.split(',') : [],
      isFeatured: Boolean(r.is_featured),
      createdAt: r.created_at,
    };

    res.json({ success: true, data: hustle });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createHustle = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const {
      title,
      description,
      price,
      priceType = 'flat',
      category,
      hostelLocation,
      sellerName,
      sellerProgram,
      whatsAppNumber,
      campus = 'knust',
      imageUrl,
      tags = [],
    } = req.body;

    if (!title || !price || !whatsAppNumber || !description) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, price, whatsAppNumber, description',
      });
    }

    const id = `hst_${Date.now()}`;
    const createdAt = new Date().toISOString();
    const tagsString = Array.isArray(tags) ? tags.join(',') : tags;

    await db.run(
      `INSERT INTO hustles 
      (id, title, description, price, price_type, category, hostel_location, seller_name, seller_program, whats_app_number, campus_id, rating, review_count, image_url, tags, is_featured, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5.0, 1, ?, ?, 0, ?)`,
      [
        id,
        title,
        description,
        Number(price),
        priceType,
        category,
        hostelLocation,
        sellerName,
        sellerProgram,
        whatsAppNumber,
        campus,
        imageUrl || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80',
        tagsString,
        createdAt,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Hustle created successfully!',
      data: {
        id,
        title,
        price,
        hostelLocation,
        createdAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteHustle = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { id } = req.params;

    const result = await db.run('DELETE FROM hustles WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Hustle not found' });
    }

    res.json({ success: true, message: 'Hustle deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
