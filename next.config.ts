import type { NextConfig } from "next";

const storageImageUrl = process.env.S3_PUBLIC_URL
  ? new URL(process.env.S3_PUBLIC_URL)
  : null;
const storageImagePattern = storageImageUrl
  ? {
      protocol: storageImageUrl.protocol === "http:" ? ("http" as const) : ("https" as const),
      hostname: storageImageUrl.hostname,
      pathname: `${storageImageUrl.pathname.replace(/\/+$/, "")}/**`,
    }
  : null;

const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME;
const cloudinaryImagePattern = cloudinaryCloudName
  ? {
      protocol: "https" as const,
      hostname: "res.cloudinary.com",
      pathname: `/${cloudinaryCloudName}/**`,
    }
  : null;

if (
  storageImageUrl &&
  storageImageUrl.protocol !== "http:" &&
  storageImageUrl.protocol !== "https:"
) {
  throw new Error("S3_PUBLIC_URL must use HTTP or HTTPS.");
}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: {
    remotePatterns: [storageImagePattern, cloudinaryImagePattern].filter(Boolean) as NonNullable<typeof storageImagePattern>[],
  },
  // Dev server blocks /_next assets for non-localhost origins; production builds are unaffected.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local", ...(process.env.ALLOWED_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])],
  // Friendly public URLs backed by the existing pages. Old URLs keep working.
  async rewrites() {
    return [{ source: "/shop/:slug", destination: "/shops/:slug" }, { source: "/@:username", destination: "/u/:username" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Camera is only needed by this origin and the embedded Persona identity-verification window.
          { key: "Permissions-Policy", value: `camera=(self "https://withpersona.com" "https://*.withpersona.com"), microphone=(), geolocation=()` },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
