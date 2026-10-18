import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { shopUpdateSchema } from "@/lib/validation/shop";
import { enforceReviewStatus } from "@/lib/review-enforcement";
import { removeOwnedContent } from "@/lib/account-lifecycle";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  const review = enforceReviewStatus(user);
  if (review.isBlocked) return review.response;

  const shop = await prisma.shop.findFirst({ where: { id, ownerId: session.user.id }, select: { id: true } });
  if (!shop) return NextResponse.json({ error: "Virtual Store not found" }, { status: 404 });
  const parsed = shopUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid store update" }, { status: 400 });
  const payload = { ...parsed.data };
  if (typeof (payload as { isPaused?: boolean }).isPaused === "boolean") {
    (payload as { isPaused: boolean }).isPaused = (payload as { isPaused: boolean }).isPaused;
  }
  await prisma.shop.update({ where: { id }, data: payload });
  return NextResponse.json({ updated: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await prisma.$transaction((tx) => removeOwnedContent(tx, "SHOP", session.user.id, id), { isolationLevel: "ReadCommitted" });
  if (result === "account-ineligible") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (result === "not-found") return NextResponse.json({ error: "Virtual Store not found" }, { status: 404 });
  if (result === "conflict") return NextResponse.json({ error: "This store changed while it was being removed. Reload and try again." }, { status: 409 });
  return NextResponse.json({ removed: true });
}
