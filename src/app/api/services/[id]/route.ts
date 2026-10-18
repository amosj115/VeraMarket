import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serviceUpdateSchema } from "@/lib/validation/service-update";
import { enforceReviewStatus } from "@/lib/review-enforcement";
import { removeOwnedContent } from "@/lib/account-lifecycle";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  const review = enforceReviewStatus(user);
  if (review.isBlocked) return review.response;

  const service = await prisma.serviceListing.findFirst({ where: { id, providerId: session.user.id } });
  if (!service) return NextResponse.json({ error: "Service not found" }, { status: 404 });
  const parsed = serviceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid update" }, { status: 400 });
  const { priceRand, ...rest } = parsed.data;
  await prisma.serviceListing.update({ where: { id }, data: { ...rest, ...(priceRand === undefined ? {} : { priceCents: Math.round(priceRand * 100) }) } });
  return NextResponse.json({ updated: true });
}
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await prisma.$transaction((tx) => removeOwnedContent(tx, "SERVICE", session.user.id, id), { isolationLevel: "ReadCommitted" });
  if (result === "account-ineligible") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (result === "not-found") return NextResponse.json({ error: "Service not found" }, { status: 404 });
  if (result === "conflict") return NextResponse.json({ error: "This service changed while it was being removed. Reload and try again." }, { status: 409 });
  return NextResponse.json({ removed: true });
}
