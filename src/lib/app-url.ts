const raw = () => (process.env.AUTH_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");

// Public origin for metadata and links. Falls back to localhost only outside production.
export function appUrl(): string {
  return raw() || "http://localhost:3000";
}

// Origin for callbacks/webhooks sent to third parties. Production must be HTTPS.
export function secureAppUrl(): string {
  const url = raw();
  if (process.env.NODE_ENV === "production" && !url.startsWith("https://")) {
    throw new Error("NEXT_PUBLIC_APP_URL and AUTH_URL must be an https:// URL in production.");
  }
  return url || "http://localhost:3000";
}
