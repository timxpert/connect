/* Prepares a photo before upload.
   Phone cameras produce 3000–4000px images. Shown at 40–140px, the browser
   shrinks them in one pass and fine detail breaks up into speckles. Resizing
   once here, in halving steps with high-quality smoothing, keeps faces clean
   and makes uploads much smaller. */

type Kind = 'avatars' | 'covers' | 'posts';

const LIMITS: Record<Kind, { w: number; h: number; square: boolean }> = {
  avatars: { w: 640, h: 640, square: true },
  covers: { w: 1800, h: 1000, square: false },
  posts: { w: 1440, h: 1440, square: false },
};

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

export async function prepareImage(file: File, kind: Kind): Promise<File> {
  // GIFs keep their animation; anything we can't read goes up unchanged
  if (file.type === 'image/gif' || !file.type.startsWith('image/')) return file;

  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await decode(file);
  } catch {
    return file;
  }
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const lim = LIMITS[kind];

  // Avatars: centred square crop
  let sx = 0,
    sy = 0,
    cw = sw,
    ch = sh;
  if (lim.square) {
    const side = Math.min(sw, sh);
    sx = Math.round((sw - side) / 2);
    sy = Math.round((sh - side) / 2);
    cw = ch = side;
  }

  const scale = Math.min(1, lim.w / cw, lim.h / ch);
  const tw = Math.max(1, Math.round(cw * scale));
  const th = Math.max(1, Math.round(ch * scale));

  // Small enough already and no crop needed: keep the original bytes
  if (scale === 1 && !lim.square && file.size < 1.5 * 1024 * 1024) return file;

  // Draw the crop at full size, then halve until within 2x of the target
  let { c, ctx } = canvas(cw, ch);
  ctx.drawImage(src as CanvasImageSource, sx, sy, cw, ch, 0, 0, cw, ch);
  let w = cw,
    h = ch;
  while (w / 2 >= tw && h / 2 >= th) {
    const next = canvas(Math.round(w / 2), Math.round(h / 2));
    next.ctx.drawImage(c, 0, 0, w, h, 0, 0, next.c.width, next.c.height);
    c = next.c;
    w = next.c.width;
    h = next.c.height;
  }
  const out = canvas(tw, th);
  out.ctx.drawImage(c, 0, 0, w, h, 0, 0, tw, th);
  if ('close' in src) src.close();

  // WebP looks the same as JPEG at roughly a third smaller. Browsers that can't
  // write WebP (older Safari) hand back a PNG instead, so fall back to JPEG.
  const encode = (type: string, q: number) => new Promise<Blob | null>((r) => out.c.toBlob(r, type, q));
  let blob = await encode('image/webp', 0.84);
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.86);
  if (!blob) return file;
  // Never upload something bigger than the original if it didn't need resizing
  if (scale === 1 && !lim.square && blob.size >= file.size) return file;
  const name = file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.jpg');
  return new File([blob], name, { type: blob.type });
}
