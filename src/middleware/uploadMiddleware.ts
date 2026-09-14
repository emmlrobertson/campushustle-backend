import multer from 'multer';
import { Request, Response, NextFunction } from 'express';

// 5 MB maximum file size
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// Allowed image MIME types
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// Magic byte signatures for image validation
function validateImageMagicBytes(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return true;
  }

  // WebP: RIFF ... WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return true;
  }

  // HEIC / HEIF: ftyp ... heic/mif1
  if (buffer.length >= 12 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return true;
  }

  return false;
}

// In-memory Multer storage (never write unvalidated files to disk)
const storage = multer.memoryStorage();

export const uploadSingleImage = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    // 1. Strict MIME type check
    const mime = file.mimetype.toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return cb(
        new Error(
          `Invalid file format '${file.mimetype}'. Allowed formats: JPEG, PNG, WebP, HEIC.`
        )
      );
    }

    // 2. Reject SVG and executable extensions
    const lowerName = file.originalname.toLowerCase();
    if (
      lowerName.endsWith('.svg') ||
      lowerName.endsWith('.html') ||
      lowerName.endsWith('.htm') ||
      lowerName.endsWith('.php') ||
      lowerName.endsWith('.js') ||
      lowerName.endsWith('.exe') ||
      lowerName.endsWith('.sh')
    ) {
      return cb(new Error('Dangerous file format rejected. Only valid image files are allowed.'));
    }

    cb(null, true);
  },
}).single('image');

// Validation middleware after Multer parses file into req.file.buffer
export const validateImageBuffer = (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "No image file provided. Please attach an image in the 'image' form field.",
    });
  }

  // Check magic bytes to prevent renamed malicious payloads
  const isValidBytes = validateImageMagicBytes(req.file.buffer);
  if (!isValidBytes) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or corrupt image content. File signature does not match image format.',
    });
  }

  next();
};

// Error wrapper for Multer limit exceptions
export const handleUploadErrors = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum allowed size is 5 MB.',
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Image upload rejected.',
    });
  }

  next();
};
