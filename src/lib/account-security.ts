import { createHmac, createHash } from "node:crypto";

/**
 * Generates a keyed HMAC of the normalized email.
 * This is used for privacy-preserving repeat-offender detection.
 */
export function hashEmailSecure(email: string, secret: string): string {
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

/**
 * Generates a legacy plain SHA-256 hash of the normalized email.
 * Used only for migrating existing records to HMAC.
 */
export function hashEmailLegacy(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
