import { Request, Response } from 'express';
import { getDatabase } from '../db/database';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

export const getAllHustles = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { campus = 'knust', category, location, search, sellerId } = req.query;

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

    if (sellerId) {
      query += ' AND seller_id = ?';
      params.push(sellerId);
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
      sellerId: r.seller_id,
      sellerName: r.seller_name,
      sellerProgram: r.seller_program,
      whatsAppNumber: r.whats_app_number,
      campus: r.campus_id,
      rating: r.rating,
      reviewCount: r.review_count,
      imageUrl: r.image_url,
      tags: r.tags ? r.tags.split(',') : [],
      isFeatured: Boolean(r.is_featured),
      deliveryMode: r.delivery_mode || 'to_client',
      status: r.status || 'OPEN',
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
      sellerId: r.seller_id,
      sellerName: r.seller_name,
      sellerProgram: r.seller_program,
      whatsAppNumber: r.whats_app_number,
      campus: r.campus_id,
      rating: r.rating,
      reviewCount: r.review_count,
      imageUrl: r.image_url,
      tags: r.tags ? r.tags.split(',') : [],
      isFeatured: Boolean(r.is_featured),
      deliveryMode: r.delivery_mode || 'to_client',
      status: r.status || 'OPEN',
      createdAt: r.created_at,
    };

    res.json({ success: true, data: hustle });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getMyHustles = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const db = await getDatabase();
    const rows = await db.all('SELECT * FROM hustles WHERE seller_id = ? ORDER BY created_at DESC', [userId]);

    const hustles = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      price: r.price,
      priceType: r.price_type,
      category: r.category,
      hostelLocation: r.hostel_location,
      sellerId: r.seller_id,
      sellerName: r.seller_name,
      sellerProgram: r.seller_program,
      whatsAppNumber: r.whats_app_number,
      campus: r.campus_id,
      rating: r.rating,
      reviewCount: r.review_count,
      imageUrl: r.image_url,
      tags: r.tags ? r.tags.split(',') : [],
      isFeatured: Boolean(r.is_featured),
      deliveryMode: r.delivery_mode || 'to_client',
      status: r.status || 'OPEN',
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

export const createHustle = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const authReq = req as AuthenticatedRequest;
    const sellerId = authReq.user?.id || req.body.sellerId || null;

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
      deliveryMode = 'to_client',
      status = 'OPEN',
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
      (id, title, description, price, price_type, category, hostel_location, seller_id, seller_name, seller_program, whats_app_number, campus_id, rating, review_count, image_url, tags, is_featured, created_at, delivery_mode, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5.0, 1, ?, ?, 0, ?, ?, ?)`,
      [
        id,
        title,
        description,
        Number(price),
        priceType,
        category,
        hostelLocation,
        sellerId,
        sellerName,
        sellerProgram,
        whatsAppNumber,
        campus,
        imageUrl || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80',
        tagsString,
        createdAt,
        deliveryMode,
        status,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Hustle created successfully!',
      data: {
        id,
        title,
        price,
        sellerId,
        hostelLocation,
        deliveryMode,
        status,
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
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    const existing = await db.get('SELECT * FROM hustles WHERE id = ?', [id]);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Hustle not found' });
    }

    // Verify ownership: only the creator can delete their listing
    if (existing.seller_id && userId && existing.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You can only delete your own listings.',
      });
    }

    await db.run('DELETE FROM hustles WHERE id = ?', [id]);

    res.json({ success: true, message: 'Hustle deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const toggleHustleStatus = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { id } = req.params;
    const { status } = req.body;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    const existing = await db.get('SELECT * FROM hustles WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Hustle not found' });
    }

    if (existing.seller_id && userId && existing.seller_id !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only update your own hustle.' });
    }

    const newStatus = status === 'BUSY' ? 'BUSY' : 'OPEN';
    await db.run('UPDATE hustles SET status = ? WHERE id = ?', [newStatus, id]);

    res.json({ success: true, message: `Status updated to ${newStatus}`, status: newStatus });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getHustleReviews = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { id } = req.params;

    const reviews = await db.all('SELECT * FROM reviews WHERE hustle_id = ? ORDER BY created_at DESC', [id]);

    res.json({
      success: true,
      count: reviews.length,
      data: reviews.map((r) => ({
        id: r.id,
        hustleId: r.hustle_id,
        reviewerId: r.reviewer_id,
        reviewerName: r.reviewer_name,
        reviewerProgram: r.reviewer_program,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.created_at,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createHustleReview = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const reviewerId = authReq.user?.id;
    const { rating, comment } = req.body;

    if (!reviewerId) {
      return res.status(401).json({ success: false, error: 'Student login required to leave a review.' });
    }

    if (!rating || !comment || Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ success: false, error: 'Please provide a star rating (1-5) and review comment.' });
    }

    const reviewer = await db.get('SELECT name, program FROM users WHERE id = ?', [reviewerId]);
    const reviewerName = reviewer ? reviewer.name : 'KNUST Student';
    const reviewerProgram = reviewer ? reviewer.program : 'Student';

    const reviewId = `rev_${Date.now()}`;
    const createdAt = new Date().toISOString();

    await db.run(
      `INSERT INTO reviews (id, hustle_id, reviewer_id, reviewer_name, reviewer_program, rating, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [reviewId, id, reviewerId, reviewerName, reviewerProgram, Number(rating), comment.trim(), createdAt]
    );

    const stats = await db.get(
      'SELECT AVG(rating) as avgRating, COUNT(*) as reviewCount FROM reviews WHERE hustle_id = ?',
      [id]
    );

    const newRating = Math.round((stats.avgRating || rating) * 10) / 10;
    const newCount = stats.reviewCount || 1;

    await db.run(
      'UPDATE hustles SET rating = ?, review_count = ? WHERE id = ?',
      [newRating, newCount, id]
    );

    res.status(201).json({
      success: true,
      message: 'Review posted successfully!',
      data: {
        id: reviewId,
        hustleId: id,
        reviewerName,
        reviewerProgram,
        rating: Number(rating),
        comment: comment.trim(),
        createdAt,
      },
      updatedHustle: {
        rating: newRating,
        reviewCount: newCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
