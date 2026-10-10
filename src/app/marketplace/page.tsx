import { prisma } from "@/lib/prisma";
import { activeListingBoosts } from "@/lib/boosts";
import { MarketplaceClient } from "./marketplace-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MarketplacePage({ searchParams }: { searchParams: SearchParams }) {
  const params = (await searchParams) as Record<string, string | string[] | undefined>;
  const query = Array.isArray(params.q) ? params.q[0] : (params.q ?? "");
  const category = Array.isArray(params.category) ? params.category[0] : (params.category ?? "");
  const radius = params.radius ? parseInt(Array.isArray(params.radius) ? params.radius[0] : params.radius, 10) : null;
  const buyerLat = params.lat ? parseFloat(Array.isArray(params.lat) ? params.lat[0] : params.lat) : null;
  const buyerLng = params.lng ? parseFloat(Array.isArray(params.lng) ? params.lng[0] : params.lng) : null;
  const sortByDistance = Array.isArray(params.sort) ? params.sort[0] === "distance" : params.sort === "distance";

  const [categories, boosts] = await Promise.all([
    prisma.category.findMany({ where: { domain: "MARKETPLACE", isEnabled: true }, orderBy: { sortOrder: "asc" } }),
    activeListingBoosts(),
  ]);

  return (
    <MarketplaceClient
      initialCategories={categories}
      initialBoosts={boosts}
      initialQuery={query}
      initialCategory={category}
      initialRadius={Number.isFinite(radius) ? radius : null}
      initialBuyerLat={buyerLat !== null && Number.isFinite(buyerLat) ? buyerLat : null}
      initialBuyerLng={buyerLng !== null && Number.isFinite(buyerLng) ? buyerLng : null}
      initialSortByDistance={sortByDistance}
    />
  );
}
