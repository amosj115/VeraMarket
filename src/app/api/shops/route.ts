import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { createShopSchema } from "@/lib/validation/shop";
import { slugify } from "@/lib/utils";

export async function GET() {
  const shops = await prisma.shop.findMany({
    where: { status: "ACTIVE", isPaused: false, subscriptionStatus: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: { products: { where: { isAvailable: true }, take: 3 } },
  });
  return NextResponse.json({ shops });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = await requireVerifiedProfile(session.user.id);
  if (blocked) return blocked;
  const parsed = createShopSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const baseSlug = slugify(parsed.data.name);
  let slug = `${baseSlug}-${Date.now().toString(36)}`;
  while (await prisma.shop.findUnique({ where: { slug } })) slug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;
  const shop = await prisma.shop.create({
    data: {
      ...parsed.data,
      ownerId: session.user.id,
      slug,
      status: "PENDING_REVIEW",
      subscriptionStatus: "PENDING",
      monthlyPriceCents: 5900,
    },
    select: { id: true, slug: true, status: true, subscriptionStatus: true },
  });
  return NextResponse.json({ shop }, { status: 201 });
}
