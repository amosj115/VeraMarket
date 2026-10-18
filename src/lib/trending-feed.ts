import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encodeTrendingCursor, type TrendingCursor } from "@/lib/trending-cursor";
import { publicListingWhere } from "@/lib/listing-visibility";

export const TRENDING_FEED_PAGE_SIZE = 8;

function createTrendingFeedSelect() {
  return {
    id: true,
    slug: true,
    title: true,
    priceCents: true,
    condition: true,
    location: true,
    areaName: true,
    createdAt: true,
    images: {
      orderBy: { sortOrder: "asc" },
      select: { url: true },
    },
    seller: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
    boosts: {
      where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
      take: 1,
      select: { id: true },
    },
  } satisfies Prisma.ListingSelect;
}

type TrendingFeedQueryRow = Prisma.ListingGetPayload<{ select: ReturnType<typeof createTrendingFeedSelect> }>;

export type TrendingFeedQuery = (
  args: Prisma.ListingFindManyArgs & { select: ReturnType<typeof createTrendingFeedSelect> },
) => Promise<TrendingFeedQueryRow[]>;

export type TrendingFeedItem = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  condition: string;
  location: string;
  areaName: string | null;
  images: Array<{ url: string }>;
  sellerId: string | null;
  sellerName: string | null;
  sellerUsername: string | null;
  sellerAvatarUrl: string | null;
  boosted: boolean;
};

export type TrendingFeedPage = {
  items: TrendingFeedItem[];
  nextCursor: string | null;
};

export async function getTrendingFeedPage(
  cursor?: TrendingCursor,
  findListings: TrendingFeedQuery = (args) => prisma.listing.findMany(args),
): Promise<TrendingFeedPage> {
  const where: Prisma.ListingWhereInput = publicListingWhere();

  if (cursor) {
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }

  const rows = await findListings({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TRENDING_FEED_PAGE_SIZE + 1,
    select: createTrendingFeedSelect(),
  });

  const hasMore = rows.length > TRENDING_FEED_PAGE_SIZE;
  const pageRows = rows.slice(0, TRENDING_FEED_PAGE_SIZE);
  const last = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;

  return {
    items: pageRows.map((listing) => ({
      id: listing.id,
      slug: listing.slug,
      title: listing.title,
      priceCents: listing.priceCents,
      condition: listing.condition,
      location: listing.location,
      areaName: listing.areaName,
      images: listing.images,
      sellerId: listing.seller.id || null,
      sellerName: listing.seller.displayName || null,
      sellerUsername: listing.seller.username || null,
      sellerAvatarUrl: listing.seller.avatarUrl || null,
      boosted: listing.boosts.length > 0,
    })),
    nextCursor: hasMore && last
      ? encodeTrendingCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}
