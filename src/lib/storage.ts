import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Storage abstraction. STORAGE_DRIVER=local writes to /public/uploads (development only);
 * STORAGE_DRIVER=s3 uses any S3-compatible bucket. Objects are written private and are served
 * through S3_PUBLIC_URL (CDN / public-read prefix) only for the public image prefix "uploads/".
 * Verification/camera images are never stored here.
 */
export class StorageError extends Error {
  constructor(message: string, public code: "NOT_CONFIGURED" | "UNAVAILABLE" | "NOT_FOUND") { super(message); }
}

const driver = () => (process.env.STORAGE_DRIVER === "s3" ? "s3" : "local");

export function storageStatus() {
  if (driver() === "local") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORAGE !== "true") return { configured: false, missing: ["STORAGE_DRIVER=s3"] };
    return { configured: true, missing: [] as string[] };
  }
  const missing = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"].filter((key) => !process.env[key]);
  return { configured: missing.length === 0, missing };
}

let client: S3Client | null = null;
function s3() {
  client ??= new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  return client;
}

function assertReady() {
  const status = storageStatus();
  if (!status.configured) throw new StorageError(`Image storage isn't configured on this server (${status.missing.join(", ")}).`, "NOT_CONFIGURED");
}

const publicBase = () => (process.env.S3_PUBLIC_URL ?? "").replace(/\/+$/, "");

/** Stores an image and returns the URL to persist (relative path locally, absolute HTTPS URL for S3). */
export async function putPublicImage(bytes: Uint8Array, ext: string, mime: string): Promise<string> {
  assertReady();
  const name = `${randomUUID()}.${ext}`;
  try {
    if (driver() === "local") {
      const dir = path.join(process.cwd(), "public", "uploads");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, name), bytes);
      return `/uploads/${name}`;
    }
    await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: `uploads/${name}`, Body: bytes, ContentType: mime, CacheControl: "public, max-age=31536000, immutable" }));
    return `${publicBase()}/uploads/${name}`;
  } catch (error) {
    console.error("[storage] put failed", error);
    throw new StorageError("We couldn't save your image right now. Please try again shortly.", "UNAVAILABLE");
  }
}

function keyFromUrl(url: string): string | null {
  if (driver() === "local") return /^\/uploads\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(url) ? url.slice(1) : null;
  const base = publicBase();
  if (!base || !url.startsWith(`${base}/uploads/`)) return null;
  const key = url.slice(base.length + 1);
  return /^uploads\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key) ? key : null;
}

/** Server-side read of a previously stored image (authenticated S3 GET, so the bucket need not allow listing or private reads publicly). */
export async function readStoredImage(url: string): Promise<Uint8Array> {
  assertReady();
  const key = keyFromUrl(url);
  if (!key) throw new StorageError("That image isn't in this server's storage.", "NOT_FOUND");
  try {
    if (driver() === "local") return new Uint8Array(await readFile(path.join(process.cwd(), "public", key)));
    const out = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return await out.Body!.transformToByteArray();
  } catch (error) {
    console.error("[storage] read failed", error);
    const missing = (error as { name?: string; code?: string }).name === "NoSuchKey" || (error as { code?: string }).code === "ENOENT";
    throw new StorageError(missing ? "Image not found." : "Image storage is temporarily unavailable.", missing ? "NOT_FOUND" : "UNAVAILABLE");
  }
}

export async function deleteStoredImage(url: string | null | undefined) {
  const key = url ? keyFromUrl(url) : null;
  if (!key || driver() !== "s3") return;
  await s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })).catch((e) => console.error("[storage] delete failed", e));
}
