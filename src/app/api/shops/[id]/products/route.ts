import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyContentPublished, safeNotify } from "@/lib/notifications";
import { shopProductSchema } from "@/lib/validation/shop-product";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const shop = await prisma.shop.findFirst({ where: { id, ownerId: session.user.id } });
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const parsed = shopProductSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid product" }, { status: 400 });

  const { priceRand, imageUrls, categoryId, stockQuantity, isFeatured, ...productData } = parsed.data;
  const product = await prisma.shopProduct.create({
    data: {
      shopId: id,
      ...productData,
      categoryId: categoryId || null,
      stockQuantity: stockQuantity ?? null,
      isFeatured: isFeatured ?? false,
      priceCents: Math.round(priceRand * 100),
      images: {
        create: imageUrls.map((url, sortOrder) => ({ url, ownerType: "SHOP_PRODUCT", sortOrder })),
      },
    },
    select: { id: true, name: true },
  });
  await safeNotify(() => notifyContentPublished("SHOP_PRODUCT", product.id));

  return NextResponse.json({ product }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "Product id is required" }, { status: 400 });

  const product = await prisma.shopProduct.findFirst({
    where: { id: productId, shopId: id, shop: { ownerId: session.user.id } },
    select: { id: true },
  });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const parsed = shopProductSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid product" }, { status: 400 });

  const { priceRand, imageUrls, categoryId, stockQuantity, isFeatured, ...productData } = parsed.data;
  await prisma.shopProduct.update({
    where: { id: productId },
    data: {
      ...productData,
      ...(categoryId === undefined ? {} : { categoryId: categoryId || null }),
      ...(stockQuantity === undefined ? {} : { stockQuantity: stockQuantity ?? null }),
      ...(isFeatured === undefined ? {} : { isFeatured }),
      ...(priceRand === undefined ? {} : { priceCents: Math.round(priceRand * 100) }),
      ...(imageUrls === undefined ? {} : { images: { deleteMany: {}, create: imageUrls.map((url, sortOrder) => ({ url, ownerType: "SHOP_PRODUCT" as const, sortOrder })) } }),
    },
  });

  return NextResponse.json({ updated: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "Product id is required" }, { status: 400 });

  const product = await prisma.shopProduct.findFirst({ where: { id: productId, shopId: id, shop: { ownerId: session.user.id } } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  await prisma.shopProduct.delete({ where: { id: productId } });
  return NextResponse.json({ removed: true });
}

