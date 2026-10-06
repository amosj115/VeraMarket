import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

/**
 * Cloudinary image storage for Vera Market.
 *
 * Images are uploaded server-side using the Cloudinary API secret.
 * The browser never receives the API secret.
 */

export class StorageError extends Error {
  constructor(
    message: string,
    public code: "NOT_CONFIGURED" | "UNAVAILABLE" | "NOT_FOUND"
  ) {
    super(message);
    this.name = "StorageError";
  }
}

function configureCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return false;
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  return true;
}

export function storageStatus() {
  const missing = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ].filter((key) => !process.env[key]);

  return {
    configured: missing.length === 0,
    missing,
  };
}

function assertReady() {
  if (!configureCloudinary()) {
    const status = storageStatus();

    throw new StorageError(
      `Image storage isn't configured on this server (${status.missing.join(
        ", "
      )}).`,
      "NOT_CONFIGURED"
    );
  }
}

/**
 * Upload an image to Cloudinary and return its secure HTTPS URL.
 */
export async function putPublicImage(
  bytes: Uint8Array,
  ext: string,
  mime: string
): Promise<string> {
  assertReady();

  const name = `${randomUUID()}`;

  try {
    const base64 = Buffer.from(bytes).toString("base64");

    const dataUri = `data:${mime};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "vera-market/uploads",
      public_id: name,
      resource_type: "image",
      type: "upload",
      overwrite: false,
      invalidate: true,
      context: {
        original_extension: ext,
      },
    });

    return result.secure_url;
  } catch (error) {
    console.error("[cloudinary] upload failed", error);

    throw new StorageError(
      "We couldn't save your image right now. Please try again shortly.",
      "UNAVAILABLE"
    );
  }
}

/**
 * Extract the Cloudinary public ID from a Vera Market Cloudinary URL.
 */
function publicIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (!parsed.hostname.endsWith("cloudinary.com")) {
      return null;
    }

    const pathname = parsed.pathname;

    const uploadMarker = "/upload/";

    const uploadIndex = pathname.indexOf(uploadMarker);

    if (uploadIndex === -1) {
      return null;
    }

    let publicPath = pathname.slice(uploadIndex + uploadMarker.length);

    // Remove transformations such as:
    // /upload/f_auto,q_auto/
    const parts = publicPath.split("/");

    while (
      parts.length > 0 &&
      /^[a-zA-Z0-9_,:=-]+$/.test(parts[0]) &&
      (
        parts[0].includes("w_") ||
        parts[0].includes("h_") ||
        parts[0].includes("c_") ||
        parts[0].includes("q_") ||
        parts[0].includes("f_") ||
        parts[0].includes("dpr_") ||
        parts[0].includes("ar_")
      )
    ) {
      parts.shift();
    }

    publicPath = parts.join("/");

    // Remove file extension.
    publicPath = publicPath.replace(/\.(jpg|jpeg|png|webp|gif|avif)$/i, "");

    if (!publicPath.startsWith("vera-market/uploads/")) {
      return null;
    }

    return publicPath;
  } catch {
    return null;
  }
}

/**
 * Server-side read of a previously stored Cloudinary image.
 *
 * This is mainly retained for compatibility with the existing
 * Vera Market storage abstraction.
 */
export async function readStoredImage(url: string): Promise<Uint8Array> {
  assertReady();

  const publicId = publicIdFromUrl(url);

  if (!publicId) {
    throw new StorageError(
      "That image isn't in this server's storage.",
      "NOT_FOUND"
    );
  }

  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: "image",
      type: "upload",
    });

    if (!result.secure_url) {
      throw new Error("Cloudinary image URL unavailable");
    }

    const response = await fetch(result.secure_url);

    if (!response.ok) {
      throw new Error(`Image download failed: ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    console.error("[cloudinary] read failed", error);

    throw new StorageError(
      "Image storage is temporarily unavailable.",
      "UNAVAILABLE"
    );
  }
}

/**
 * Delete an image from Cloudinary.
 */
export async function deleteStoredImage(
  url: string | null | undefined
) {
  if (!url) return;

  const publicId = publicIdFromUrl(url);

  if (!publicId) return;

  try {
    assertReady();

    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      type: "upload",
      invalidate: true,
    });
  } catch (error) {
    console.error("[cloudinary] delete failed", error);
  }
}