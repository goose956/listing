import sharp from 'sharp';

/** Fetch an image from a URL and return it as a Buffer. */
async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Combine multiple image URLs into a single grid collage and return
 * as a base64 data URI suitable for the OpenAI vision API.
 *
 * Layout:
 *  1 image   — single image (no grid, just resized)
 *  2 images  — 1×2 grid (side by side)
 *  3-4       — 2×2 grid
 *  5-9       — 3×3 grid
 *  10+       — 4×4 grid (only first 10 used)
 *
 * Images that fail to fetch are skipped silently so a single broken
 * URL never breaks the entire analysis.
 */
export async function createImageCollage(
  imageUrls: string[],
  options: { maxImages?: number; thumbSize?: number } = {}
): Promise<string> {
  const { maxImages = 10, thumbSize = 512 } = options;
  const urls = imageUrls.slice(0, maxImages);

  if (urls.length === 0) {
    throw new Error('No images provided for collage');
  }

  // Fetch all images, skipping any that fail
  const buffers: Buffer[] = [];
  for (const url of urls) {
    try {
      buffers.push(await fetchImage(url));
    } catch (err) {
      console.warn(`Skipping image during collage: ${url}`, err);
    }
  }

  if (buffers.length === 0) {
    throw new Error('Failed to fetch any images for collage');
  }

  // Single image — resize and return as data URI (no collage needed)
  if (buffers.length === 1) {
    const resized = await sharp(buffers[0])
      .rotate()
      .resize(thumbSize, thumbSize, { fit: 'inside' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${resized.toString('base64')}`;
  }

  // Determine grid columns
  let cols: number;
  if (buffers.length <= 2) cols = 2;
  else if (buffers.length <= 4) cols = 2;
  else if (buffers.length <= 9) cols = 3;
  else cols = 4;

  const rows = Math.ceil(buffers.length / cols);
  const gap = 8;
  const canvasWidth = cols * thumbSize + (cols + 1) * gap;
  const canvasHeight = rows * thumbSize + (rows + 1) * gap;

  // Resize each image to a thumbnail and prepare composite positions
  const composites = await Promise.all(
    buffers.map(async (buf, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const left = gap + col * (thumbSize + gap);
      const top = gap + row * (thumbSize + gap);

      const resized = await sharp(buf)
        .rotate() // honour EXIF orientation
        .resize(thumbSize, thumbSize, { fit: 'inside', position: 'centre' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();

      return { input: resized, left, top };
    })
  );

  // Create white canvas and composite all thumbnails
  const collage = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  return `data:image/jpeg;base64,${collage.toString('base64')}`;
}
