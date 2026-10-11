import { prisma } from "@/lib/prisma";
import { getListings, parseDistanceParams } from "@/lib/listings";
import { MarketplaceClient } from "./marketplace-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MarketplacePage({ searchParams }: { searchParams: SearchParams }) {
  const params = (await searchParams) as Record<string, string | string[] | undefined>;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const query = first(params.q) ?? "";
  const category = first(params.category) ?? "";
  // Same clamped distance params the API uses, so server paint and client fetch agree.
  const { buyerLat, buyerLng, radius, sortByDistance } = parseDistanceParams({
    lat: first(params.lat),
    lng: first(params.lng),
    radius: first(params.radius),
    sort: first(params.sort),
  });

  // Listings and categories are independent — fetch them together so the first
  // paint already contains real results instead of an empty grid the client fills.
  const [categories, initialListings] = await Promise.all([
    prisma.category.findMany({ where: { domain: "MARKETPLACE", isEnabled: true }, orderBy: { sortOrder: "asc" } }),
    getListings({ q: query || undefined, category: category || undefined, page: 1, buyerLat, buyerLng, radius, sortByDistance }),
  ]);

  return (
    <MarketplaceClient
      initialCategories={categories}
      initialQuery={query}
      initialCategory={category}
      initialRadius={radius}
      initialBuyerLat={buyerLat}
      initialBuyerLng={buyerLng}
      initialSortByDistance={sortByDistance}
      initialListings={initialListings.listings}
    />
  );
}
