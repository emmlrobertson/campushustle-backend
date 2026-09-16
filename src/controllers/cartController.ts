import { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { z } from 'zod';

const addToCartSchema = z.object({
  hustleId: z.string().min(1, 'Hustle ID is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').default(1),
});

const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0, 'Quantity cannot be negative'),
});

function formatCartItem(item: any) {
  const unitPrice = Number(item.hustle.price);
  const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;
  const image = item.hustle.images && item.hustle.images[0] ? item.hustle.images[0].imageUrl : '';

  return {
    id: item.id,
    hustleId: item.hustleId,
    title: item.hustle.title,
    price: unitPrice,
    quantity: item.quantity,
    lineTotal,
    imageUrl: image,
    stockQuantity: item.hustle.stockQuantity,
    trackStock: item.hustle.trackStock,
    status: item.hustle.status,
    sellerId: item.hustle.sellerProfileId,
    sellerName: item.hustle.sellerProfile?.businessName || item.hustle.sellerProfile?.user?.name || 'Seller',
    campusCode: item.hustle.university?.code || 'KNUST',
  };
}

/**
 * GET /api/cart
 * Retrieve current student's shopping cart with live server-side prices
 */
export const getCart = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    let cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            hustle: {
              include: {
                sellerProfile: { include: { user: true } },
                images: true,
                university: true,
              },
            },
          },
        },
      },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId },
        include: {
          items: {
            include: {
              hustle: {
                include: {
                  sellerProfile: { include: { user: true } },
                  images: true,
                  university: true,
                },
              },
            },
          },
        },
      });
    }

    const formattedItems = cart.items.map(formatCartItem);
    const totalAmount = formattedItems.reduce((acc, item) => acc + item.lineTotal, 0);

    res.json({
      success: true,
      data: {
        id: cart.id,
        items: formattedItems,
        itemCount: formattedItems.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        currency: 'GHS',
      },
    });
  } catch (error: any) {
    console.error('getCart error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve cart' });
  }
};

/**
 * POST /api/cart/items
 * Add an item to the authenticated student's cart
 */
export const addToCart = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const validation = addToCartSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.flatten(),
      });
    }

    const { hustleId, quantity } = validation.data;

    // Verify hustle exists and is active
    const hustle = await prisma.hustle.findUnique({
      where: { id: hustleId },
      include: { sellerProfile: true },
    });

    if (!hustle || hustle.status !== 'ACTIVE') {
      return res.status(404).json({ success: false, error: 'Listing is not active or available' });
    }

    // Prevent self-purchase
    if (hustle.sellerProfile.userId === userId) {
      return res.status(400).json({ success: false, error: 'You cannot add your own hustle to the cart' });
    }

    // Check stock
    if (hustle.trackStock && hustle.stockQuantity < quantity) {
      return res.status(409).json({
        success: false,
        error: `Insufficient stock. Only ${hustle.stockQuantity} remaining.`,
      });
    }

    // Ensure cart exists
    let cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      cart = await prisma.cart.create({ data: { userId } });
    }

    // Upsert cart item
    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_hustleId: {
          cartId: cart.id,
          hustleId,
        },
      },
    });

    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;
      if (hustle.trackStock && hustle.stockQuantity < newQuantity) {
        return res.status(409).json({
          success: false,
          error: `Cannot add more. Maximum available stock is ${hustle.stockQuantity}.`,
        });
      }

      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: newQuantity },
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          hustleId,
          quantity,
        },
      });
    }

    // Return updated cart
    return getCart(req, res);
  } catch (error: any) {
    console.error('addToCart error:', error);
    res.status(500).json({ success: false, error: 'Failed to add item to cart' });
  }
};

/**
 * PATCH /api/cart/items/:id
 * Update quantity of a cart item
 */
export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const validation = updateCartItemSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid quantity',
        details: validation.error.flatten(),
      });
    }

    const { quantity } = validation.data;

    // Find cart item and verify ownership
    const cartItem = await prisma.cartItem.findUnique({
      where: { id },
      include: {
        cart: true,
        hustle: true,
      },
    });

    if (!cartItem || cartItem.cart.userId !== userId) {
      return res.status(404).json({ success: false, error: 'Cart item not found' });
    }

    if (quantity === 0) {
      await prisma.cartItem.delete({ where: { id } });
    } else {
      if (cartItem.hustle.trackStock && cartItem.hustle.stockQuantity < quantity) {
        return res.status(409).json({
          success: false,
          error: `Only ${cartItem.hustle.stockQuantity} items in stock.`,
        });
      }

      await prisma.cartItem.update({
        where: { id },
        data: { quantity },
      });
    }

    return getCart(req, res);
  } catch (error: any) {
    console.error('updateCartItem error:', error);
    res.status(500).json({ success: false, error: 'Failed to update cart item' });
  }
};

/**
 * DELETE /api/cart/items/:id
 * Remove an item from the cart
 */
export const removeFromCart = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const cartItem = await prisma.cartItem.findUnique({
      where: { id },
      include: { cart: true },
    });

    if (!cartItem || cartItem.cart.userId !== userId) {
      return res.status(404).json({ success: false, error: 'Cart item not found' });
    }

    await prisma.cartItem.delete({ where: { id } });

    return getCart(req, res);
  } catch (error: any) {
    console.error('removeFromCart error:', error);
    res.status(500).json({ success: false, error: 'Failed to remove cart item' });
  }
};

/**
 * DELETE /api/cart
 * Clear all items from the current student's cart
 */
export const clearCart = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const cart = await prisma.cart.findUnique({ where: { userId } });
    if (cart) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }

    res.json({
      success: true,
      message: 'Cart cleared successfully',
      data: { items: [], itemCount: 0, totalAmount: 0, currency: 'GHS' },
    });
  } catch (error: any) {
    console.error('clearCart error:', error);
    res.status(500).json({ success: false, error: 'Failed to clear cart' });
  }
};
