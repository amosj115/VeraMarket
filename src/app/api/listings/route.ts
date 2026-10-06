import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { createListingSchema } from "@/lib/validation/listing";
import { slugify } from "@/lib/utils";
import { activeListingBoosts } from "@/lib/boosts";

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

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        images: { take: 1, orderBy: { sortOrder: "asc" } },
        category: { select: { name: true, slug: true } },
      },
    }),
    prisma.listing.count({ where }),
  ]);

  const boosts = await activeListingBoosts();
  let ordered = listings;
  if (page === 1 && boosts.size) {
    const boosted = await prisma.listing.findMany({ where: { ...where, id: { in: [...boosts.keys()] } }, take: 12, include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, category: { select: { name: true, slug: true } } } });
    const merged = new Map([...boosted, ...listings].map((listing) => [listing.id, listing]));
    ordered = [...merged.values()].sort((a, b) => (boosts.get(b.id) ?? 0) - (boosts.get(a.id) ?? 0) || b.createdAt.getTime() - a.createdAt.getTime()).slice(0, pageSize);
  }
  return NextResponse.json({ listings: ordered.map((listing) => ({ ...listing, boosted: boosts.has(listing.id) })), total, page, pageSize });
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

  const { title, description, priceRand, categoryId, condition, location, imageUrls } =
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
