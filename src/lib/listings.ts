import { prisma } from "@/lib/prisma";
import { activeListingBoosts, listingWeight } from "@/lib/boosts";
import { activeStoreOwners, type ActiveStore } from "@/lib/shops";
import { publicListingWhere } from "@/lib/listing-visibility";

// One query path for "browse listings", shared by the marketplace page's
// server-rendered first paint and GET /api/listings. Keeping a single
// implementation means filters, placement order and the payload shape can
// never drift between the two.

export type ListingQueryInput = {
  q?: string;
  category?: string;
  condition?: string;
  location?: string;
  minPrice?: string;
  maxPrice?: string;
  page: number;
  buyerLat?: number | null;
  buyerLng?: number | null;
  radius?: number | null;
  sortByDistance?: boolean;
};

export type ListingCard = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  condition: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  areaName: string | null;
  status: string;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
  sellerId: string;
  categoryId: string;
  images: { url: string }[];
  category: { name: string; slug: string };
  boosted: boolean;
  visibilityWeight: number;
  store: ActiveStore | null;
};

const PAGE_SIZE = 24;

// Haversine formula to calculate distance between two points in kilometers
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return R * c;
}

/** Distance params, clamped so a malformed value can never blank the marketplace. */
export function parseDistanceParams(params: { lat?: string | null; lng?: string | null; radius?: string | null; sort?: string | null }) {
  const rawLat = params.lat ? parseFloat(params.lat) : null;
  const rawLng = params.lng ? parseFloat(params.lng) : null;
  const rawRadius = params.radius ? parseInt(params.radius, 10) : null;
  const buyerLat = rawLat !== null && Number.isFinite(rawLat) && Math.abs(rawLat) <= 90 ? rawLat : null;
  const buyerLng = rawLng !== null && Number.isFinite(rawLng) && Math.abs(rawLng) <= 180 ? rawLng : null;
  const radius = rawRadius !== null && Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : null;
  return { buyerLat, buyerLng, radius, sortByDistance: params.sort === "distance" };
}

export async function getListings(input: ListingQueryInput): Promise<{ listings: ListingCard[]; total: number; page: number; pageSize: number }> {
  const { q, category: categorySlug, condition, location, minPrice, maxPrice, page } = input;
  const buyerLat = input.buyerLat ?? null;
  const buyerLng = input.buyerLng ?? null;
  const radius = input.radius ?? null;
  const sortByDistance = input.sortByDistance ?? false;
  const pageSize = PAGE_SIZE;

  const where: Record<string, unknown> = publicListingWhere();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  if (categorySlug) where.category = { slug: categorySlug };
  if (condition) where.condition = condition;
  if (location) where.location = { contains: location, mode: "insensitive" };
  if (minPrice || maxPrice) {
    where.priceCents = {
      ...(minPrice ? { gte: Number(minPrice) * 100 } : {}),
      ...(maxPrice ? { lte: Number(maxPrice) * 100 } : {}),
    };
  }

  // If distance filtering is requested, we need to filter in memory after fetching
  // since Prisma doesn't support geospatial queries natively
  const needsDistanceFilter = buyerLat !== null && buyerLng !== null && radius !== null;

  // A listing without coordinates has an unknown location (created before location
  // support, or the seller never set one). Its distance cannot be computed, so it is
  // not "outside the radius" — it stays in the results instead of being dropped.
  const withinRadius = (listing: { latitude: number | null; longitude: number | null }): boolean => {
    if (!needsDistanceFilter) return true;
    if (listing.latitude == null || listing.longitude == null) return true;
    const distance = haversineDistance(buyerLat!, buyerLng!, listing.latitude, listing.longitude);
    return Number.isFinite(distance) && distance <= radius!;
  };

  // The page row set and the total are independent — run them together.
  const [found, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize * (needsDistanceFilter ? 5 : 1), // Fetch more if filtering by distance
      include: {
        images: { take: 1, orderBy: { sortOrder: "asc" } },
        category: { select: { name: true, slug: true } },
      },
    }),
    prisma.listing.count({ where }),
  ]);
  let listings = found;

  if (needsDistanceFilter) {
    listings = listings.filter(withinRadius);
    if (sortByDistance) {
      listings.sort((a, b) => {
        const aKnown = a.latitude != null && a.longitude != null;
        const bKnown = b.latitude != null && b.longitude != null;
        if (!aKnown && !bKnown) return 0;
        if (!aKnown) return 1;
        if (!bKnown) return -1;
        const distA = haversineDistance(buyerLat!, buyerLng!, a.latitude!, a.longitude!);
        const distB = haversineDistance(buyerLat!, buyerLng!, b.latitude!, b.longitude!);
        return distA - distB;
      });
    }
    listings = listings.slice(0, pageSize);
  }

  // Placement weights: paid boosts (duration packages 1-4, percent packages 50/100)
  // and the 25% Virtual Store baseline, taken as the maximum of the two per listing.
  // Organic order stays newest-first; on page 1 the strongest weighted listings are
  // merged in front, so 100 > 50 > 25 > paid duration tiers > organic. Distance
  // sorting is explicit user intent and is never overridden by placement.
  // Fetched fresh every request: a subscription purchase or expiry must change
  // placement and badges immediately (product guarantee), and both tables are small.
  const [boosts, stores] = await Promise.all([activeListingBoosts(), activeStoreOwners()]);
  const weightOf = (listing: { id: string; sellerId: string }) => listingWeight(boosts.get(listing.id), stores.has(listing.sellerId));
  let ordered = listings;
  if (page === 1 && !sortByDistance && (boosts.size || stores.size)) {
    const boostedIds = [...boosts.keys()];
    const storeOwnerIds = [...stores.keys()];
    const candidateOr = [
      ...(boostedIds.length ? [{ id: { in: boostedIds } }] : []),
      ...(storeOwnerIds.length ? [{ sellerId: { in: storeOwnerIds } }] : []),
    ];
    // Fetch a generous window of weighted candidates matching the current filters,
    // keep the strongest 12, and let the final sort place them above organic pages.
    const candidates = (await prisma.listing.findMany({
      where: { ...where, AND: [{ OR: candidateOr }] },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, category: { select: { name: true, slug: true } } },
    })).filter(withinRadius);
    const promoted = candidates
      .map((listing) => ({ listing, weight: weightOf(listing) }))
      .filter((row) => row.weight > 0)
      .sort((a, b) => b.weight - a.weight || b.listing.createdAt.getTime() - a.listing.createdAt.getTime())
      .slice(0, 12)
      .map((row) => row.listing);
    const merged = new Map([...promoted, ...listings].map((listing) => [listing.id, listing]));
    ordered = [...merged.values()]
      .sort((a, b) => weightOf(b) - weightOf(a) || b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, pageSize);
  }

  // Explicit card shape: no description (the heaviest scalar, unused by both the
  // marketplace grid and the API's consumers) and no unused scalars.
  const cards: ListingCard[] = ordered.map((listing) => ({
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    priceCents: listing.priceCents,
    condition: listing.condition,
    location: listing.location,
    latitude: listing.latitude,
    longitude: listing.longitude,
    areaName: listing.areaName,
    status: listing.status,
    viewCount: listing.viewCount,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
    sellerId: listing.sellerId,
    categoryId: listing.categoryId,
    images: listing.images.map((image) => ({ url: image.url })),
    category: listing.category,
    boosted: (boosts.get(listing.id) ?? 0) > 0,
    visibilityWeight: weightOf(listing),
    store: stores.get(listing.sellerId) ?? null,
  }));

  return { listings: cards, total, page, pageSize };
}
