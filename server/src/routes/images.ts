import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';

export const imagesRouter = Router();

type BackgroundColor = 'white' | 'light_gray' | 'light_gray_textured' | 'dark_gray' | 'black';

const BACKGROUND_RGB: Record<BackgroundColor, { r: number; g: number; b: number }> = {
  white: { r: 255, g: 255, b: 255 },
  light_gray: { r: 229, g: 231, b: 235 },
  light_gray_textured: { r: 229, g: 231, b: 235 },
  dark_gray: { r: 71, g: 85, b: 105 },
  black: { r: 15, g: 23, b: 42 },
};

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

function parseBackgroundColor(value: unknown): BackgroundColor | null {
  if (typeof value !== 'string') return null;
  if (
    value === 'white'
    || value === 'light_gray'
    || value === 'light_gray_textured'
    || value === 'dark_gray'
    || value === 'black'
  ) {
    return value;
  }
  return null;
}

function parseCorrectionNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 240) : null;
}

type ColourCorrection = {
  redGain: number;
  greenGain: number;
  blueGain: number;
  saturation: number;
  brightness: number;
};

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function combineCorrections(base: ColourCorrection, next: Partial<ColourCorrection>): ColourCorrection {
  return {
    redGain: base.redGain * (next.redGain ?? 1),
    greenGain: base.greenGain * (next.greenGain ?? 1),
    blueGain: base.blueGain * (next.blueGain ?? 1),
    saturation: base.saturation * (next.saturation ?? 1),
    brightness: base.brightness * (next.brightness ?? 1),
  };
}

function buildColourCorrection(note: string | null): ColourCorrection | null {
  if (!note) return null;

  const normalized = note.toLowerCase();
  let correction: ColourCorrection = {
    redGain: 1,
    greenGain: 1,
    blueGain: 1,
    saturation: 1,
    brightness: 1,
  };
  let changed = false;

  const apply = (next: Partial<ColourCorrection>) => {
    correction = combineCorrections(correction, next);
    changed = true;
  };

  if (/bronze|gold|golden|orange cast|too orange/.test(normalized)) {
    apply({ redGain: 0.9, greenGain: 0.97, blueGain: 1.14, saturation: 0.95 });
  }
  if (/silver|grey|gray/.test(normalized) && /should|look|read|be/.test(normalized)) {
    apply({ redGain: 0.94, greenGain: 0.98, blueGain: 1.08, saturation: 0.9 });
  }
  if (/too warm|warm cast|yellow cast|too yellow/.test(normalized)) {
    apply({ redGain: 0.94, greenGain: 0.99, blueGain: 1.1, saturation: 0.96 });
  }
  if (/too cool|cool cast|too blue|blue cast/.test(normalized)) {
    apply({ redGain: 1.08, greenGain: 1.01, blueGain: 0.92, saturation: 0.98 });
  }
  if (/too green|green cast/.test(normalized)) {
    apply({ redGain: 1.04, greenGain: 0.92, blueGain: 1.04 });
  }
  if (/too pink|too magenta|pink cast|magenta cast/.test(normalized)) {
    apply({ redGain: 0.95, greenGain: 1.05, blueGain: 0.97 });
  }
  if (/too dark|underexposed|dark image/.test(normalized)) {
    apply({ brightness: 1.06 });
  }
  if (/too bright|overexposed|washed out/.test(normalized)) {
    apply({ brightness: 0.97, saturation: 1.03 });
  }

  return changed ? correction : null;
}

function applyColourCorrection(
  data: Buffer<ArrayBufferLike>,
  width: number,
  height: number,
  channels: number,
  correction: ColourCorrection
) {
  const output = Buffer.from(data);

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const index = pixelIndex * channels;
    const alpha = output[index + 3] ?? 255;
    if (alpha === 0) continue;

    const correctedRed = clampChannel(output[index] * correction.redGain * correction.brightness);
    const correctedGreen = clampChannel(output[index + 1] * correction.greenGain * correction.brightness);
    const correctedBlue = clampChannel(output[index + 2] * correction.blueGain * correction.brightness);

    if (correction.saturation === 1) {
      output[index] = correctedRed;
      output[index + 1] = correctedGreen;
      output[index + 2] = correctedBlue;
      continue;
    }

    const luminance = correctedRed * 0.2126 + correctedGreen * 0.7152 + correctedBlue * 0.0722;
    output[index] = clampChannel(luminance + (correctedRed - luminance) * correction.saturation);
    output[index + 1] = clampChannel(luminance + (correctedGreen - luminance) * correction.saturation);
    output[index + 2] = clampChannel(luminance + (correctedBlue - luminance) * correction.saturation);
  }

  return output;
}

function pseudoNoise(x: number, y: number) {
  const seed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return seed - Math.floor(seed);
}

function texturedGrayRgb(x: number, y: number) {
  const base = BACKGROUND_RGB.light_gray_textured;
  const grain = (pseudoNoise(x, y) - 0.5) * 10;
  const wave = Math.sin((x + y) / 18) * 3 + Math.cos(y / 23) * 2;
  const tint = Math.max(-12, Math.min(12, grain + wave));

  return {
    r: Math.max(0, Math.min(255, Math.round(base.r + tint))),
    g: Math.max(0, Math.min(255, Math.round(base.g + tint))),
    b: Math.max(0, Math.min(255, Math.round(base.b + tint))),
  };
}

function averageCornerSample(
  data: Buffer<ArrayBufferLike>,
  width: number,
  height: number,
  channels: number,
  startX: number,
  startY: number,
  sampleSize: number
) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let y = startY; y < Math.min(startY + sampleSize, height); y += 1) {
    for (let x = startX; x < Math.min(startX + sampleSize, width); x += 1) {
      const index = (y * width + x) * channels;
      const alpha = data[index + 3] ?? 255;
      if (alpha < 200) continue;
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      count += 1;
    }
  }

  if (count === 0) {
    return { r: 255, g: 255, b: 255 };
  }

  return {
    r: red / count,
    g: green / count,
    b: blue / count,
  };
}

function estimateBackgroundColor(data: Buffer<ArrayBufferLike>, width: number, height: number, channels: number) {
  const sampleSize = Math.max(6, Math.min(24, Math.floor(Math.min(width, height) * 0.08)));
  const corners = [
    averageCornerSample(data, width, height, channels, 0, 0, sampleSize),
    averageCornerSample(data, width, height, channels, Math.max(0, width - sampleSize), 0, sampleSize),
    averageCornerSample(data, width, height, channels, 0, Math.max(0, height - sampleSize), sampleSize),
    averageCornerSample(data, width, height, channels, Math.max(0, width - sampleSize), Math.max(0, height - sampleSize), sampleSize),
  ];

  return corners.reduce(
    (acc, corner) => ({
      r: acc.r + corner.r / corners.length,
      g: acc.g + corner.g / corners.length,
      b: acc.b + corner.b / corners.length,
    }),
    { r: 0, g: 0, b: 0 }
  );
}

function colorDistance(
  data: Buffer<ArrayBufferLike>,
  index: number,
  background: { r: number; g: number; b: number }
) {
  const dr = data[index] - background.r;
  const dg = data[index + 1] - background.g;
  const db = data[index + 2] - background.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function detectBackgroundMask(data: Buffer<ArrayBufferLike>, width: number, height: number, channels: number) {
  const pixelCount = width * height;
  const background = estimateBackgroundColor(data, width, height, channels);
  const visited = new Uint8Array(pixelCount);
  const distances = new Float32Array(pixelCount);
  const queue: number[] = [];
  const seedThreshold = 42;
  const spreadThreshold = 58;
  const featherThreshold = 78;

  const maybeSeed = (pixelIndex: number) => {
    if (visited[pixelIndex]) return;
    const dataIndex = pixelIndex * channels;
    const alpha = data[dataIndex + 3] ?? 255;
    if (alpha < 200) return;
    const distance = colorDistance(data, dataIndex, background);
    distances[pixelIndex] = distance;
    if (distance <= seedThreshold) {
      visited[pixelIndex] = 1;
      queue.push(pixelIndex);
    }
  };

  for (let x = 0; x < width; x += 1) {
    maybeSeed(x);
    maybeSeed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    maybeSeed(y * width);
    maybeSeed(y * width + (width - 1));
  }

  while (queue.length > 0) {
    const pixelIndex = queue.shift()!;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const neighbors = [
      x > 0 ? pixelIndex - 1 : -1,
      x < width - 1 ? pixelIndex + 1 : -1,
      y > 0 ? pixelIndex - width : -1,
      y < height - 1 ? pixelIndex + width : -1,
    ];

    for (const neighbor of neighbors) {
      if (neighbor < 0 || visited[neighbor]) continue;
      const dataIndex = neighbor * channels;
      const alpha = data[dataIndex + 3] ?? 255;
      if (alpha < 200) continue;
      const distance = colorDistance(data, dataIndex, background);
      distances[neighbor] = distance;
      if (distance <= spreadThreshold) {
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }

  const mask = new Float32Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const distance = distances[pixelIndex] || colorDistance(data, pixelIndex * channels, background);
    if (visited[pixelIndex]) {
      mask[pixelIndex] = 1;
      continue;
    }

    if (distance > featherThreshold) continue;

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const neighbors = [
      x > 0 ? pixelIndex - 1 : -1,
      x < width - 1 ? pixelIndex + 1 : -1,
      y > 0 ? pixelIndex - width : -1,
      y < height - 1 ? pixelIndex + width : -1,
    ];

    if (neighbors.some((neighbor) => neighbor >= 0 && visited[neighbor])) {
      mask[pixelIndex] = Math.max(0, Math.min(1, (featherThreshold - distance) / (featherThreshold - spreadThreshold)));
    }
  }

  return mask;
}

function applyBackgroundColor(
  data: Buffer<ArrayBufferLike>,
  width: number,
  height: number,
  channels: number,
  backgroundColor: BackgroundColor
) {
  const mask = detectBackgroundMask(data, width, height, channels);
  const output = Buffer.from(data);

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const strength = mask[pixelIndex];
    if (strength <= 0) continue;

    const index = pixelIndex * channels;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const target = backgroundColor === 'light_gray_textured'
      ? texturedGrayRgb(x, y)
      : BACKGROUND_RGB[backgroundColor];

    output[index] = Math.round(output[index] * (1 - strength) + target.r * strength);
    output[index + 1] = Math.round(output[index + 1] * (1 - strength) + target.g * strength);
    output[index + 2] = Math.round(output[index + 2] * (1 - strength) + target.b * strength);
  }

  return output;
}

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
    const backgroundColor = parseBackgroundColor(req.body?.backgroundColor);
    const correctionNote = parseCorrectionNote(req.body?.correctionNote);

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
    // - Optional restrained colour-cast correction from user guidance
    // - Auto-orient from EXIF
    // - Convert to JPEG for consistency
    // NO: colour replacement, inpainting, background removal that hides damage
    const enhancedSource = await sharp(inputBuffer)
      .rotate() // honour EXIF orientation
      .normalize({ lower: 2, upper: 98 }) // gentle histogram stretch
      .modulate({
        brightness: 1.05, // slight lift
        saturation: 1.02, // barely touch saturation (keep true colours)
      })
      .linear(1.08, -8) // mild contrast
      .sharpen({ sigma: 0.8, m1: 0.5, m2: 0.3 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const colourCorrection = buildColourCorrection(correctionNote);
    const colourAdjustedPixels = colourCorrection
      ? applyColourCorrection(
          enhancedSource.data,
          enhancedSource.info.width,
          enhancedSource.info.height,
          enhancedSource.info.channels,
          colourCorrection
        )
      : enhancedSource.data;

    const enhancedPixels = backgroundColor
      ? applyBackgroundColor(
          colourAdjustedPixels,
          enhancedSource.info.width,
          enhancedSource.info.height,
          enhancedSource.info.channels,
          backgroundColor
        )
      : colourAdjustedPixels;

    const enhanced = await sharp(enhancedPixels, {
      raw: {
        width: enhancedSource.info.width,
        height: enhancedSource.info.height,
        channels: enhancedSource.info.channels,
      },
    })
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
