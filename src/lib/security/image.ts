export type DetectedImage = { mime: string; ext: string };

const SIGNATURES: { mime: string; ext: string; magic: number[] }[] = [
  { mime: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp", ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
];

// The deployed platform (Vercel) rejects request bodies over 4.5 MB with a
// 413 before the route handler runs, so the app limit must stay below that
// with room for the multipart boundary. Keep client and server in sync.
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const IMAGE_MIN_DIMENSION = 16;
export const IMAGE_MAX_DIMENSION = 8000;

export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  for (const sig of SIGNATURES) {
    if (!sig.magic.every((byte, i) => bytes[i] === byte)) continue;
    if (sig.mime === "image/webp" && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== "WEBP") continue;
    return { mime: sig.mime, ext: sig.ext };
  }
  return null;
}

// HEIC/HEIF files start with an ISO-BMFF "ftyp" box. Browsers can't decode
// these uniformly, so they get a dedicated message (the client converts what
// it can before uploading).
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"];
export function isHeicImage(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) !== "ftyp") return false;
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return HEIC_BRANDS.includes(brand);
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let markerIndex = i + 1;
    // Skip fill bytes (0xFF padding between markers).
    while (markerIndex + 1 < bytes.length && bytes[markerIndex] === 0xff) markerIndex += 1;
    const marker = bytes[markerIndex];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = markerIndex + 1;
      continue;
    }
    // EOI or start of scan without a frame header: no dimensions available.
    if (marker === 0xd9 || marker === 0xda) return null;
    // SOF0-SOF15 except DHT (C4), JPG (C8), DAC (CC).
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (bytes[markerIndex + 4] << 8) | bytes[markerIndex + 5];
      const width = (bytes[markerIndex + 6] << 8) | bytes[markerIndex + 7];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const length = (bytes[markerIndex + 1] << 8) | bytes[markerIndex + 2];
    if (length < 2) return null;
    i = markerIndex + 1 + length;
  }
  return null;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
  const width = ((bytes[16] << 24) >>> 0) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19];
  const height = ((bytes[20] << 24) >>> 0) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23];
  return width > 0 && height > 0 ? { width, height } : null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === "VP8 ") {
    // Lossy: 3-byte frame tag, start code 9D 01 2A, then 14-bit width/height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = ((bytes[26] | (bytes[27] << 8)) & 0x3fff) || 0;
    const height = ((bytes[28] | (bytes[29] << 8)) & 0x3fff) || 0;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const b21 = bytes[21];
    const b22 = bytes[22];
    const b23 = bytes[23];
    const width = 1 + (((b22 & 0x0f) << 8) | b21);
    const height = 1 + ((b23 << 4) | (b22 >> 4));
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8X") {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

export function getImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const detected = detectImageType(bytes);
  if (!detected) return null;
  if (detected.mime === "image/jpeg") return jpegDimensions(bytes);
  if (detected.mime === "image/png") return pngDimensions(bytes);
  return webpDimensions(bytes);
}

export type ImageValidation =
  | { ok: true; image: DetectedImage; width: number; height: number }
  | { ok: false; code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "HEIC_UNSUPPORTED" | "UNSUPPORTED_TYPE" | "DAMAGED_IMAGE" | "IMAGE_DIMENSIONS"; message: string };

// Shared by every image upload route so client-facing limits, messages and
// accepted formats always agree.
export function validateImageUpload(bytes: Uint8Array): ImageValidation {
  if (bytes.length === 0) {
    return { ok: false, code: "EMPTY_FILE", message: "That file is empty. Please choose a photo." };
  }
  if (bytes.length > IMAGE_MAX_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: `Photos must be ${formatMegabytes(IMAGE_MAX_BYTES)} or smaller. Please choose a smaller photo.` };
  }
  if (isHeicImage(bytes)) {
    return { ok: false, code: "HEIC_UNSUPPORTED", message: "HEIC/HEIF photos aren't supported here. Choose a JPEG, PNG or WebP photo instead — in your photo library, share or export it as JPEG." };
  }
  const image = detectImageType(bytes);
  if (!image) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: "Only JPEG, PNG and WebP photos are supported." };
  }
  const dims = getImageDimensions(bytes);
  if (!dims) {
    return { ok: false, code: "DAMAGED_IMAGE", message: "That photo file appears to be damaged or incomplete. Please choose another photo." };
  }
  if (dims.width < IMAGE_MIN_DIMENSION || dims.height < IMAGE_MIN_DIMENSION) {
    return { ok: false, code: "IMAGE_DIMENSIONS", message: `That photo is too small — it must be at least ${IMAGE_MIN_DIMENSION}×${IMAGE_MIN_DIMENSION} pixels.` };
  }
  if (dims.width > IMAGE_MAX_DIMENSION || dims.height > IMAGE_MAX_DIMENSION) {
    return { ok: false, code: "IMAGE_DIMENSIONS", message: `That photo is too large — its longest side must be under ${IMAGE_MAX_DIMENSION} pixels.` };
  }
  return { ok: true, image, width: dims.width, height: dims.height };
}

export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}
