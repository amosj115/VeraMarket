import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { createListingSchema } from "@/lib/validation/listing";
import { slugify } from "@/lib/utils";
import { activeListingBoosts, listingWeight } from "@/lib/boosts";
import { activeStoreOwners } from "@/lib/shops";

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

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim();
  const categorySlug = params.get("category");
  const condition = params.get("condition");
  const location = params.get("location")?.trim();
  const minPrice = params.get("minPrice");
  const maxPrice = params.get("maxPrice");
  const page = Math.max(1, Number(params.get("page") ?? "1"));
  const pageSize = 24;

  // Distance filtering parameters. Malformed or out-of-range values are treated as
  // "no location filter" so a bad parameter can never blank out the whole marketplace.
  const rawLat = params.get("lat") ? parseFloat(params.get("lat")!) : null;
  const rawLng = params.get("lng") ? parseFloat(params.get("lng")!) : null;
  const rawRadius = params.get("radius") ? parseInt(params.get("radius")!, 10) : null;
  const buyerLat = rawLat !== null && Number.isFinite(rawLat) && Math.abs(rawLat) <= 90 ? rawLat : null;
  const buyerLng = rawLng !== null && Number.isFinite(rawLng) && Math.abs(rawLng) <= 180 ? rawLng : null;
  const radius = rawRadius !== null && Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : null;
  const sortByDistance = params.get("sort") === "distance";

  const where: Record<string, unknown> = { status: "ACTIVE" };

  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  if (categorySlug) {
    where.category = { slug: categorySlug };
  }
  if (condition) {
    where.condition = condition;
  }
  if (location) {
    where.location = { contains: location, mode: "insensitive" };
  }
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

  let listings = await prisma.listing.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize * (needsDistanceFilter ? 5 : 1), // Fetch more if filtering by distance
    include: {
      images: { take: 1, orderBy: { sortOrder: "asc" } },
      category: { select: { name: true, slug: true } },
    },
  });

  const total = await prisma.listing.count({ where });

  // Apply distance filtering in memory if needed
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

    // Apply pagination after filtering
    listings = listings.slice(0, pageSize);
  }

  // Placement weights: paid boosts (duration packages 1-4, percent packages 50/100)
  // and the 25% Virtual Store baseline, taken as the maximum of the two per listing.
  // Organic order stays newest-first; on page 1 the strongest weighted listings are
  // merged in front, so 100 > 50 > 25 > paid duration tiers > organic. Distance
  // sorting is explicit user intent and is never overridden by placement.
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
  return NextResponse.json({ listings: ordered.map((listing) => ({ ...listing, boosted: (boosts.get(listing.id) ?? 0) > 0, visibilityWeight: weightOf(listing), store: stores.get(listing.sellerId) ?? null })), total, page, pageSize });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blocked = await requireVerifiedProfile(session.user.id);
  if (blocked) return blocked;

  const body = await request.json().catch(() => null);
  const parsed = createListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { title, description, priceRand, categoryId, condition, location, latitude, longitude, areaName, imageUrls } =
    parsed.data;

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.domain !== "MARKETPLACE") {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const baseSlug = slugify(title);
  let slug = `${baseSlug}-${Date.now().toString(36)}`;
  // Ensure uniqueness even under (unlikely) collisions.
  while (await prisma.listing.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const listing = await prisma.listing.create({
    data: {
      sellerId: session.user.id,
      categoryId,
      title,
      slug,
      description,
      priceCents: Math.round(priceRand * 100),
      condition,
      location,
      latitude,
      longitude,
      areaName,
      status: "PENDING_REVIEW",
      images: {
        create: imageUrls.map((url, index) => ({
          url,
          ownerType: "LISTING",
          sortOrder: index,
        })),
      },
    },
    select: { id: true, slug: true },
  });

  return NextResponse.json({ listing }, { status: 201 });
}
