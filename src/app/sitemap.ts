import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/app-url";
import { publicPath } from "@/lib/share";
import { activeShopFilter } from "@/lib/shops";
import { publicListingWhere } from "@/lib/listing-visibility";
import { publicPropertyWhere, publicServiceWhere } from "@/lib/content-visibility";

// Search engines re-fetch the sitemap periodically; rebuilding it on every crawler
// hit re-ran four 5000-row queries. An hourly ISR window is plenty for new listings.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = appUrl();
  const activeListings = publicListingWhere();
  const [listings, shops, services, properties] = await Promise.all([
    prisma.listing.findMany({ where: activeListings, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 5000 }),
    prisma.shop.findMany({ where: activeShopFilter(), select: { slug: true, updatedAt: true }, take: 5000 }),
    prisma.serviceListing.findMany({ where: publicServiceWhere(), select: { slug: true, updatedAt: true }, take: 5000 }),
    prisma.propertyListing.findMany({ where: publicPropertyWhere(), select: { slug: true, updatedAt: true }, take: 5000 }),
  ]);
  return [
    { url: `${origin}/`, changeFrequency: "daily" },
    { url: `${origin}/marketplace`, changeFrequency: "hourly" },
    { url: `${origin}/shops`, changeFrequency: "daily" },
    ...listings.map((r) => ({ url: `${origin}${publicPath("LISTING", r.slug)}`, lastModified: r.updatedAt })),
    ...shops.map((r) => ({ url: `${origin}${publicPath("SHOP", r.slug)}`, lastModified: r.updatedAt })),
    ...services.map((r) => ({ url: `${origin}${publicPath("SERVICE", r.slug)}`, lastModified: r.updatedAt })),
    ...properties.map((r) => ({ url: `${origin}${publicPath("PROPERTY", r.slug)}`, lastModified: r.updatedAt })),
  ];
}
