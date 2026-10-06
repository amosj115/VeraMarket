const raw = () => (process.env.AUTH_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");

function configuredUrl(): string {
  const url = raw();
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Set NEXT_PUBLIC_APP_URL or AUTH_URL to the public HTTPS origin in production.");
    }
    return "http://localhost:3000";
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("AUTH_URL, NEXTAUTH_URL, and NEXT_PUBLIC_APP_URL must be valid absolute URLs.");
  }

  if (url.includes('"') || url.includes("'")) {
    throw new Error("AUTH_URL, NEXTAUTH_URL, and NEXT_PUBLIC_APP_URL must not contain embedded quotes.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    (parsed.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
  ) {
    throw new Error("Set NEXT_PUBLIC_APP_URL or AUTH_URL to the public HTTPS origin in production.");
  }

  return url;
}

// Public origin for metadata and links. Falls back to localhost only outside production.
export function appUrl(): string {
  return configuredUrl();
}

// Origin for callbacks/webhooks sent to third parties. Production must be HTTPS.
export function secureAppUrl(): string {
  return configuredUrl();
}
