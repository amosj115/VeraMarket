import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyContentPublished, safeNotify } from "@/lib/notifications";
import { moderatePendingListing } from "@/lib/listing-moderation";
import { moderatePendingEntity } from "@/lib/entity-moderation";

const moderationSchema = z.object({
  targetType: z.enum(["LISTING", "SHOP", "SERVICE", "PROPERTY"]),
  targetId: z.string().cuid(),
  decision: z.enum(["APPROVE", "REJECT"]),
});

async function moderatorOnly() {
  const session = await auth();
  return session?.user && ["ADMIN", "MODERATOR"].includes(session.user.role) ? session : null;
}

export async function GET() {
  if (!(await moderatorOnly())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [listings, shops, services, properties] = await Promise.all([
    prisma.listing.findMany({ where: { status: "PENDING_REVIEW" }, orderBy: { createdAt: "asc" }, include: { seller: { select: { username: true } }, category: { select: { name: true } }, images: { take: 1, orderBy: { sortOrder: "asc" } } } }),
    prisma.shop.findMany({ where: { status: "PENDING_REVIEW" }, orderBy: { createdAt: "asc" }, include: { owner: { select: { username: true } } } }),
    prisma.serviceListing.findMany({ where: { status: "PENDING_REVIEW" }, orderBy: { createdAt: "asc" }, include: { provider: { select: { username: true } }, category: { select: { name: true } } } }),
    prisma.propertyListing.findMany({ where: { status: "PENDING_REVIEW" }, orderBy: { createdAt: "asc" }, include: { owner: { select: { username: true } } } }),
  ]);
  return NextResponse.json({ listings, shops, services, properties });
}

export async function PATCH(request: NextRequest) {
  const session = await moderatorOnly();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = moderationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid moderation decision" }, { status: 400 });
  const { targetType, targetId, decision } = parsed.data;
  const status = decision === "APPROVE" ? "ACTIVE" : "REJECTED";
  const result = targetType === "LISTING"
    ? await prisma.$transaction((tx) => moderatePendingListing(tx, targetId, decision), { isolationLevel: "ReadCommitted" })
    : await prisma.$transaction((tx) => moderatePendingEntity(tx, targetType, targetId, decision), { isolationLevel: "ReadCommitted" });
  if (result.kind === "not-found") return NextResponse.json({ error: `Pending ${targetType.toLowerCase()} not found` }, { status: 404 });
  if (result.kind === "seller-ineligible") {
    return NextResponse.json({ error: `The seller is not eligible to publish this ${targetType.toLowerCase()}.` }, { status: 409 });
  }
  if (result.kind === "conflict") {
    return NextResponse.json({ error: `This ${targetType.toLowerCase()} changed during moderation. Reload and try again.` }, { status: 409 });
  }
  const ownerId = result.sellerId;
  const title = result.title;

  await prisma.$transaction([
    prisma.notification.create({ data: { userId: ownerId!, type: decision === "APPROVE" ? "LISTING_APPROVED" : "LISTING_REJECTED", title: decision === "APPROVE" ? "Submission approved" : "Submission needs changes", body: decision === "APPROVE" ? `"${title}" is now public on Vera Market.` : `"${title}" was not approved. Please review it and submit an updated version.` } }),
    prisma.auditLog.create({ data: { actorId: session.user.id, action: `CONTENT_${decision}`, targetType, targetId, metadata: { title } } }),
  ]);
  if (decision === "APPROVE" && targetType !== "SHOP") {
    await safeNotify(() => notifyContentPublished(targetType, targetId));
  }
  return NextResponse.json({ targetType, targetId, status });
}
