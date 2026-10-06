import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/app-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/dashboard", "/messages", "/profile", "/onboarding", "/pro"] }],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}