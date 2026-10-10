import { IMAGE_MAX_BYTES, detectImageType, isHeicImage, validateImageUpload } from "@/lib/security/image";

export { IMAGE_MAX_BYTES };

// Client-side normalization and error mapping for photo uploads.
// Oversized or HEIC/HEIF photos are decoded in the browser and re-encoded
// (iteratively shrinking dimensions/quality) until the actual Blob.size is
// below IMAGE_MAX_BYTES. If no attempt can fit, the upload never happens.

export const NORMALIZE_MAX_DIMENSION = 3072;
export const NORMALIZE_START_QUALITY = 0.9;
export const NORMALIZE_MIN_QUALITY = 0.55;
export const NORMALIZE_QUALITY_STEP = 0.85;
export const NORMALIZE_DIMENSION_STEP = 0.8;
export const NORMALIZE_ALPHA_DIMENSION_STEP = 0.7;
export const NORMALIZE_MIN_DIMENSION = 640;
export const NORMALIZE_MAX_ATTEMPTS = 8;
export const UPLOAD_TIMEOUT_MS = 120_000;

export function sniffFileKind(file: File, bytes: Uint8Array): "jpeg" | "png" | "webp" | "heic" | "unknown" {
  if (isHeicImage(bytes)) return "heic";
  const detected = detectImageType(bytes);
  if (!detected) return "unknown";
  return detected.mime === "image/jpeg" ? "jpeg" : detected.mime === "image/png" ? "png" : "webp";
}

export function photoFileTooLargeMessage(fileSize: number): string {
  const mb = (fileSize / (1024 * 1024)).toFixed(1);
  return `That photo is ${mb}MB — photos must be ${IMAGE_MAX_BYTES / (1024 * 1024)}MB or smaller. Choose a smaller photo.`;
}

type DecodedImage = { source: CanvasImageSource; width: number; height: number };

// createImageBitmap applies EXIF orientation where supported; older engines
// need the option spelled out. The <img> fallback relies on the browser's
// default `image-orientation: from-image` handling.
async function decodeToBitmap(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      try {
        const bitmap = await createImageBitmap(file);
        return { source: bitmap, width: bitmap.width, height: bitmap.height };
      } catch {
        // Fall through to the <img> decoder below.
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty image");
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, maxDimension: number): HTMLCanvasElement | null {
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Samples a downscaled copy for any non-opaque pixel. Conservative on
// failure: non-JPEG sources are assumed to keep alpha so a transparent
// background can never be silently flattened onto black.
async function sourceHasAlpha(decoded: DecodedImage, kind: "jpeg" | "png" | "webp" | "heic"): Promise<boolean> {
  if (kind === "jpeg") return false;
  try {
    const probe = drawScaled(decoded.source, decoded.width, decoded.height, 192);
    const context = probe?.getContext("2d", { willReadFrequently: true });
    if (!probe || !context) return true;
    const data = context.getImageData(0, 0, probe.width, probe.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}

async function canvasEncodesWebp(): Promise<boolean> {
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const blob = await canvasToBlob(probe, "image/webp", 0.9);
    return blob?.type === "image/webp";
  } catch {
    return false;
  }
}

type OutputFormat = { format: "jpeg" | "png" | "webp"; mime: string; ext: string };
const OUTPUT_FORMATS: Record<OutputFormat["format"], OutputFormat> = {
  jpeg: { format: "jpeg", mime: "image/jpeg", ext: "jpg" },
  png: { format: "png", mime: "image/png", ext: "png" },
  webp: { format: "webp", mime: "image/webp", ext: "webp" },
};

function encodeAt(source: DecodedImage, maxDimension: number, spec: OutputFormat, quality: number): Promise<File | null> {
  const canvas = drawScaled(source.source, source.width, source.height, maxDimension);
  if (!canvas) return Promise.resolve(null);
  return canvasToBlob(canvas, spec.mime, quality).then((blob) => {
    if (!blob) return null;
    // Old Safari "falls back" to PNG when asked for WebP — refuse the lie.
    // An empty blob.type is tolerated (some engines omit it for JPEG).
    if (blob.type && blob.type !== spec.mime) return null;
    return new File([blob], `photo.${spec.ext}`, { type: spec.mime });
  });
}

// Iterative compression: checks the real Blob.size after every attempt and
// only ever returns a file at or below IMAGE_MAX_BYTES. Opaque photos go to
// JPEG (quality first, then dimensions). Images with transparency keep an
// alpha-capable format (PNG, then WebP where supported) and shrink dimensions
// instead, so transparent backgrounds are preserved.
export async function normalizeImageForUpload(file: File, kind: "jpeg" | "png" | "webp" | "heic"): Promise<File> {
  let decoded: DecodedImage;
  try {
    decoded = await decodeToBitmap(file);
  } catch {
    if (kind === "heic") {
      throw new Error("This photo is in HEIC/HEIF format which your browser can't convert. Please pick a different photo, or export it as JPEG from your photo library first.");
    }
    throw new Error("We couldn't read that photo. It may be damaged or incomplete — please choose another one.");
  }

  const hasAlpha = await sourceHasAlpha(decoded, kind);
  const webpSupported = hasAlpha ? await canvasEncodesWebp() : false;
  const startDimension = Math.min(NORMALIZE_MAX_DIMENSION, Math.max(decoded.width, decoded.height));

  let dimension = startDimension;
  let quality = NORMALIZE_START_QUALITY;
  for (let attempt = 0; attempt < NORMALIZE_MAX_ATTEMPTS; attempt++) {
    const formats: OutputFormat[] = hasAlpha
      ? webpSupported
        ? [OUTPUT_FORMATS.png, OUTPUT_FORMATS.webp]
        : [OUTPUT_FORMATS.png]
      : [OUTPUT_FORMATS.jpeg];
    for (const spec of formats) {
      const converted = await encodeAt(decoded, dimension, spec, quality);
      if (converted && converted.size > 0 && converted.size <= IMAGE_MAX_BYTES) {
        return converted;
      }
    }
    // No format fit this round — shrink and try again.
    if (hasAlpha) {
      // PNG ignores quality, so reduce dimensions every round.
      if (dimension <= NORMALIZE_MIN_DIMENSION) break;
      dimension = Math.max(NORMALIZE_MIN_DIMENSION, Math.round(dimension * NORMALIZE_ALPHA_DIMENSION_STEP));
    } else if (quality > NORMALIZE_MIN_QUALITY) {
      quality = Math.max(NORMALIZE_MIN_QUALITY, quality * NORMALIZE_QUALITY_STEP);
    } else if (dimension > NORMALIZE_MIN_DIMENSION) {
      dimension = Math.max(NORMALIZE_MIN_DIMENSION, Math.round(dimension * NORMALIZE_DIMENSION_STEP));
    } else {
      break;
    }
  }

  throw new Error(
    `We couldn't compress that photo below ${IMAGE_MAX_BYTES / (1024 * 1024)}MB on this device. ` +
      "Please try a different photo, or use a smaller image (under 3000 pixels on the longest side)."
  );
}

// Entry point used by every upload flow: passes small valid photos through
// untouched, and compresses/converts everything else before any upload starts.
export async function prepareImageForUpload(file: File): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffFileKind(file, bytes);
  if (kind === "unknown") {
    throw new Error("That file isn't a photo we support. Choose a JPEG, PNG or WebP photo.");
  }
  const needsProcessing = kind === "heic" || bytes.length > IMAGE_MAX_BYTES;
  if (!needsProcessing) {
    const validation = validateImageUpload(bytes);
    if (!validation.ok) throw new Error(validation.message);
    return file;
  }
  return normalizeImageForUpload(file, kind);
}

export type UploadOutcome =
  | { ok: true; photoUrl: string }
  | { ok: false; message: string };

// Maps any failed upload (including non-JSON platform errors such as Vercel's
// 413 FUNCTION_PAYLOAD_TOO_LARGE page) to a message safe to show the user.
export function photoUploadErrorMessage(input: { status: number; body: unknown; kind: "network" | "timeout" | "response" }): string {
  if (input.kind === "timeout") return "The upload took too long and was interrupted. Check your connection and tap retry.";
  if (input.kind === "network") return "We couldn't reach the server. Check your connection and tap retry.";
  if (input.status === 413) return `That photo is too large — photos must be ${IMAGE_MAX_BYTES / (1024 * 1024)}MB or smaller.`;
  if (input.status === 401) return "Your session has expired. Please sign in again, then retry the upload.";
  if (input.status === 429) return "Too many attempts. Please wait a minute, then try again.";
  const body = input.body && typeof input.body === "object" ? (input.body as { error?: unknown }) : null;
  if (body && typeof body.error === "string" && body.error.trim()) return body.error;
  if (input.status >= 500) return "Something went wrong on our side and the photo wasn't saved. Please try again.";
  return "The upload didn't finish. Please try again.";
}

export type UploadPhotoXhr = {
  xhr: XMLHttpRequest;
  promise: Promise<UploadOutcome>;
};

// Upload with progress + timeout so mobile users see feedback and interrupted
// requests resolve to a retryable outcome instead of hanging.
export function uploadProfilePhoto(file: File, onProgress?: (percent: number | null) => void): UploadPhotoXhr {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: UploadOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    xhr.upload.onprogress = (event) => {
      if (onProgress) onProgress(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null);
    };
    xhr.upload.onload = () => onProgress?.(100);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Non-JSON error page (e.g. platform 413) — handled by the mapper.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const photoUrl = body && typeof body === "object" ? (body as { photoUrl?: unknown }).photoUrl : null;
        if (typeof photoUrl === "string" && photoUrl) return settle({ ok: true, photoUrl });
        return settle({ ok: false, message: "The upload finished but the server didn't confirm it. Please try again." });
      }
      settle({ ok: false, message: photoUploadErrorMessage({ status: xhr.status, body, kind: "response" }) });
    };
    xhr.onerror = () => settle({ ok: false, message: photoUploadErrorMessage({ status: 0, body: null, kind: "network" }) });
    xhr.ontimeout = () => settle({ ok: false, message: photoUploadErrorMessage({ status: 0, body: null, kind: "timeout" }) });
    xhr.onabort = () => settle({ ok: false, message: "The upload was cancelled. Please try again." });
    xhr.open("POST", "/api/profile/photo");
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    const body = new FormData();
    body.append("file", file, file.name || "photo.jpg");
    body.append("consent", "true");
    xhr.send(body);
  });
  return { xhr, promise };
}
