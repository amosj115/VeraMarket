import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encodeTrendingCursor, type TrendingCursor } from "@/lib/trending-cursor";
import { publicListingWhere } from "@/lib/listing-visibility";

export const TRENDING_FEED_PAGE_SIZE = 8;

export type TrendingFeedItem = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  condition: string;
  location: string;
  areaName: string | null;
  imageUrl: string | null;
  sellerName: string | null;
};

export type TrendingFeedPage = {
  items: TrendingFeedItem[];
  nextCursor: string | null;
};

export async function getTrendingFeedPage(cursor?: TrendingCursor): Promise<TrendingFeedPage> {
  const where: Prisma.ListingWhereInput = publicListingWhere();
  if (cursor) {
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }

  const rows = await prisma.listing.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TRENDING_FEED_PAGE_SIZE + 1,
    select: {
      id: true,
      slug: true,
      title: true,
      priceCents: true,
      condition: true,
      location: true,
      areaName: true,
      createdAt: true,
      images: {
        take: 1,
        orderBy: { sortOrder: "asc" },
        select: { url: true },
      },
      seller: { select: { displayName: true } },
    },
  });

  const hasMore = rows.length > TRENDING_FEED_PAGE_SIZE;
  const pageRows = rows.slice(0, TRENDING_FEED_PAGE_SIZE);
  const last = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map((listing) => ({
      id: listing.id,
      slug: listing.slug,
      title: listing.title,
      priceCents: listing.priceCents,
      condition: listing.condition,
      location: listing.location,
      areaName: listing.areaName,
      imageUrl: listing.images[0]?.url ?? null,
      sellerName: listing.seller.displayName || null,
    })),
    nextCursor: hasMore && last
      ? encodeTrendingCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}
