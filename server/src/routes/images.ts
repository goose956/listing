import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';

export const imagesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

/**
 * Enhance an image for ecommerce presentation.
 * Improves lighting/brightness/contrast WITHOUT altering product truthfulness.
 * Does NOT remove damage, stains, or change colours artificially.
 *
 * Accepts multipart file field "image" OR JSON { imageBase64: string }
 * Returns: image/jpeg buffer
 */
imagesRouter.post('/enhance', upload.single('image'), async (req, res) => {
  try {
    let inputBuffer: Buffer;

    if (req.file) {
      inputBuffer = req.file.buffer;
    } else if (req.body?.imageBase64) {
      const b64 = String(req.body.imageBase64).replace(/^data:image\/\w+;base64,/, '');
      inputBuffer = Buffer.from(b64, 'base64');
    } else {
      return res.status(400).json({ error: 'Provide image file or imageBase64' });
    }

    // Truthful ecommerce enhancement only:
    // - Normalise exposure slightly
    // - Mild contrast for product visibility
    // - Mild sharpening
    // - Auto-orient from EXIF
    // - Convert to JPEG for consistency
    // NO: colour replacement, inpainting, background removal that hides damage
    const enhanced = await sharp(inputBuffer)
      .rotate() // honour EXIF orientation
      .normalize({ lower: 2, upper: 98 }) // gentle histogram stretch
      .modulate({
        brightness: 1.05, // slight lift
        saturation: 1.02, // barely touch saturation (keep true colours)
      })
      .linear(1.08, -8) // mild contrast
      .sharpen({ sigma: 0.8, m1: 0.5, m2: 0.3 })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': enhanced.length,
      'Cache-Control': 'no-store',
    });
    res.send(enhanced);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image enhancement failed';
    console.error('Enhance error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * Resize/compress for upload preview (client helper).
 */
imagesRouter.post('/prepare', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'image file required' });
    }

    const prepared = await sharp(req.file.buffer)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': prepared.length,
    });
    res.send(prepared);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image prepare failed';
    res.status(500).json({ error: message });
  }
});
