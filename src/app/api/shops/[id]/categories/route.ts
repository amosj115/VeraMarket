import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { shopCategorySchema } from "@/lib/validation/shop-category";

function toSlug(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug || "category";
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const shop = await prisma.shop.findFirst({ where: { id, ownerId: session.user.id }, select: { id: true } });
  if (!shop) return NextResponse.json({ error: "Virtual Store not found" }, { status: 404 });

  const categories = await prisma.shopCategory.findMany({
    where: { shopId: id },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ categories });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const shop = await prisma.shop.findFirst({ where: { id, ownerId: session.user.id }, select: { id: true } });
  if (!shop) return NextResponse.json({ error: "Virtual Store not found" }, { status: 404 });

  const parsed = shopCategorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid category" }, { status: 400 });

  const name = parsed.data.name.trim();
  const slug = toSlug(name);
  const existing = await prisma.shopCategory.findFirst({ where: { shopId: id, slug } });
  if (existing) return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });

  const sortOrder = typeof parsed.data.sortOrder === "number" ? parsed.data.sortOrder : await prisma.shopCategory.count({ where: { shopId: id } });

  const category = await prisma.shopCategory.create({
    data: {
      shopId: id,
      name,
      slug,
      description: parsed.data.description || null,
      sortOrder,
    },
  });

  return NextResponse.json({ category }, { status: 201 });
}
