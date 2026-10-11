import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { createListingSchema } from "@/lib/validation/listing";
import { slugify } from "@/lib/utils";
import { getListings, parseDistanceParams } from "@/lib/listings";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get("page") ?? "1"));
  const { buyerLat, buyerLng, radius, sortByDistance } = parseDistanceParams({
    lat: params.get("lat"),
    lng: params.get("lng"),
    radius: params.get("radius"),
    sort: params.get("sort"),
  });

  const result = await getListings({
    q: params.get("q")?.trim(),
    category: params.get("category") ?? undefined,
    condition: params.get("condition") ?? undefined,
    location: params.get("location")?.trim(),
    minPrice: params.get("minPrice") ?? undefined,
    maxPrice: params.get("maxPrice") ?? undefined,
    page,
    buyerLat,
    buyerLng,
    radius,
    sortByDistance,
  });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  // A held or deleted account's token is tombstoned (id stripped) by the `jwt` callback,
  // so `session.user.id` is undefined here. Guard it before any lookup, since passing
  // undefined into the profile gate would throw.
  if (!session?.user?.id) {
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
