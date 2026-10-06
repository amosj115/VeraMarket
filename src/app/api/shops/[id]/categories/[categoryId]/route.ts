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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, categoryId } = await params;
  const category = await prisma.shopCategory.findFirst({
    where: { id: categoryId, shop: { ownerId: session.user.id } },
    select: { id: true, shopId: true },
  });
  if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });

  const parsed = shopCategorySchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid category update" }, { status: 400 });

  const name = parsed.data.name?.trim();
  const description = typeof parsed.data.description === "string" ? parsed.data.description.trim() : undefined;
  const sortOrder = typeof parsed.data.sortOrder === "number" ? parsed.data.sortOrder : undefined;

  if (name) {
    const slug = toSlug(name);
    const existing = await prisma.shopCategory.findFirst({ where: { shopId: id, slug, NOT: { id: categoryId } } });
    if (existing) return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });
  }

  const updated = await prisma.shopCategory.update({
    where: { id: categoryId },
    data: {
      ...(name ? { name, slug: toSlug(name) } : {}),
      ...(typeof description === "string" ? { description: description || null } : {}),
      ...(typeof sortOrder === "number" ? { sortOrder } : {}),
    },
  });

  return NextResponse.json({ category: updated });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, categoryId } = await params;
  const category = await prisma.shopCategory.findFirst({
    where: { id: categoryId, shop: { ownerId: session.user.id } },
    select: { id: true, shopId: true },
  });
  if (!category) return NextResponse.json({ error: "Category not found" }, { status: 404 });

  if (id !== category.shopId) return NextResponse.json({ error: "Category does not belong to this store" }, { status: 400 });

  await prisma.shopCategory.delete({ where: { id: categoryId } });
  return NextResponse.json({ removed: true });
}
