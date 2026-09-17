import dotenv from 'dotenv';
dotenv.config();
import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface ImageUploadResult {
  imageUrl: string;
  thumbnailUrl: string;
  publicId: string;
}

export interface IStorageProvider {
  uploadImage(buffer: Buffer, mimeType: string, folder?: string): Promise<ImageUploadResult>;
  deleteImage(publicId: string): Promise<boolean>;
}

// ----------------------------------------------------------------------------
// 1. Cloudinary Storage Provider (Production)
// ----------------------------------------------------------------------------
export class CloudinaryStorageProvider implements IStorageProvider {
  constructor(cloudName: string, apiKey: string, apiSecret: string) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  async uploadImage(buffer: Buffer, mimeType: string, folder = 'campushustle/hustles'): Promise<ImageUploadResult> {
    const randomName = `hst_img_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: randomName,
          resource_type: 'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
          transformation: [
            { quality: 'auto', fetch_format: 'auto' }, // Automatic mobile bandwidth compression
          ],
        },
        (error, result) => {
          if (error || !result) {
            return reject(new Error(`Cloudinary upload failed: ${error?.message || 'Unknown error'}`));
          }

          // Generate 300x300 smart thumbnail URL
          const thumbnailUrl = cloudinary.url(result.public_id, {
            transformation: [
              { width: 300, height: 300, crop: 'fill', gravity: 'auto' },
              { quality: 'auto', fetch_format: 'auto' },
            ],
            secure: true,
          });

          resolve({
            imageUrl: result.secure_url,
            thumbnailUrl: thumbnailUrl || result.secure_url,
            publicId: result.public_id,
          });
        }
      );

      uploadStream.end(buffer);
    });
  }

  async deleteImage(publicId: string): Promise<boolean> {
    try {
      const res = await cloudinary.uploader.destroy(publicId);
      return res.result === 'ok';
    } catch (err) {
      console.warn(`Cloudinary delete warning for ${publicId}:`, err);
      return false;
    }
  }
}

// ----------------------------------------------------------------------------
// 2. Local Disk Storage Provider (Local Development & Offline Fallback)
// ----------------------------------------------------------------------------
export class LocalStorageProvider implements IStorageProvider {
  private uploadsDir: string;

  constructor(uploadsDir?: string) {
    this.uploadsDir = uploadsDir || path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  async uploadImage(buffer: Buffer, mimeType: string): Promise<ImageUploadResult> {
    let ext = 'jpg';
    if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('webp')) ext = 'webp';
    else if (mimeType.includes('heic')) ext = 'heic';

    const safeFilename = `hst_img_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const filePath = path.join(this.uploadsDir, safeFilename);

    await fs.promises.writeFile(filePath, buffer);

    const publicUrl = `/uploads/${safeFilename}`;

    return {
      imageUrl: publicUrl,
      thumbnailUrl: publicUrl,
      publicId: `local_${safeFilename}`,
    };
  }

  async deleteImage(publicId: string): Promise<boolean> {
    try {
      const filename = publicId.replace('local_', '');
      const filePath = path.join(this.uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      return true;
    } catch (err) {
      console.warn(`Local file delete error for ${publicId}:`, err);
      return false;
    }
  }
}

// ----------------------------------------------------------------------------
// 3. Storage Service Factory & Singleton
// ----------------------------------------------------------------------------
class StorageService {
  private provider: IStorageProvider;
  public readonly isCloudinary: boolean;

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'doxkrnkkz';
    const apiKey = process.env.CLOUDINARY_API_KEY || '686757399225734';
    const apiSecret = process.env.CLOUDINARY_API_SECRET || 'my0nWTzwZqBASS5J0QuR9K_Mlss';

    if (cloudName && apiKey && apiSecret) {
      this.provider = new CloudinaryStorageProvider(cloudName, apiKey, apiSecret);
      this.isCloudinary = true;
      console.log('☁️ Storage Provider: Cloudinary CDN Connected');
    } else {
      this.provider = new LocalStorageProvider();
      this.isCloudinary = false;
      console.log('💾 Storage Provider: Local Disk Storage Active (/uploads)');
    }
  }

  async uploadImage(buffer: Buffer, mimeType: string, folder?: string): Promise<ImageUploadResult> {
    return this.provider.uploadImage(buffer, mimeType, folder);
  }

  async deleteImage(publicId: string): Promise<boolean> {
    return this.provider.deleteImage(publicId);
  }
}

export const storageService = new StorageService();
