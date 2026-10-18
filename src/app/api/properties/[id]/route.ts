import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { propertyUpdateSchema } from "@/lib/validation/property-update";
import { dropPropertyMatchNotifications, safeNotify } from "@/lib/notifications";
import { enforceReviewStatus } from "@/lib/review-enforcement";
import { removeOwnedContent } from "@/lib/account-lifecycle";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  const review = enforceReviewStatus(user);
  if (review.isBlocked) return review.response;

  const property = await prisma.propertyListing.findFirst({ where: { id, ownerId: session.user.id } });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  const parsed = propertyUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid update" }, { status: 400 });
  const { priceRand, ...rest } = parsed.data;
  await prisma.propertyListing.update({ where: { id }, data: { ...rest, ...(priceRand === undefined ? {} : { priceCents: Math.round(priceRand * 100) }) } });
  return NextResponse.json({ updated: true });
}
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await prisma.$transaction((tx) => removeOwnedContent(tx, "PROPERTY", session.user.id, id), { isolationLevel: "ReadCommitted" });
  if (result === "account-ineligible") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (result === "not-found") return NextResponse.json({ error: "Property not found" }, { status: 404 });
  if (result === "conflict") return NextResponse.json({ error: "This property changed while it was being removed. Reload and try again." }, { status: 409 });
  await safeNotify(() => dropPropertyMatchNotifications(id));
  return NextResponse.json({ removed: true });
}
