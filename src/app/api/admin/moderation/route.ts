import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyContentPublished, safeNotify } from "@/lib/notifications";

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
  let ownerId: string | undefined;
  let title = "Content";

  if (targetType === "LISTING") {
    const record = await prisma.listing.findFirst({ where: { id: targetId, status: "PENDING_REVIEW" }, select: { sellerId: true, title: true } });
    if (!record) return NextResponse.json({ error: "Pending listing not found" }, { status: 404 });
    ownerId = record.sellerId; title = record.title;
    await prisma.listing.update({ where: { id: targetId }, data: { status } });
  } else if (targetType === "SHOP") {
    const record = await prisma.shop.findFirst({ where: { id: targetId, status: "PENDING_REVIEW" }, select: { ownerId: true, name: true } });
    if (!record) return NextResponse.json({ error: "Pending shop not found" }, { status: 404 });
    ownerId = record.ownerId; title = record.name;
    await prisma.shop.update({ where: { id: targetId }, data: { status } });
  } else if (targetType === "SERVICE") {
    const record = await prisma.serviceListing.findFirst({ where: { id: targetId, status: "PENDING_REVIEW" }, select: { providerId: true, title: true } });
    if (!record) return NextResponse.json({ error: "Pending service not found" }, { status: 404 });
    ownerId = record.providerId; title = record.title;
    await prisma.serviceListing.update({ where: { id: targetId }, data: { status } });
  } else {
    const record = await prisma.propertyListing.findFirst({ where: { id: targetId, status: "PENDING_REVIEW" }, select: { ownerId: true, title: true } });
    if (!record) return NextResponse.json({ error: "Pending property not found" }, { status: 404 });
    ownerId = record.ownerId; title = record.title;
    await prisma.propertyListing.update({ where: { id: targetId }, data: { status } });
  }

  await prisma.$transaction([
    prisma.notification.create({ data: { userId: ownerId!, type: decision === "APPROVE" ? "LISTING_APPROVED" : "LISTING_REJECTED", title: decision === "APPROVE" ? "Submission approved" : "Submission needs changes", body: decision === "APPROVE" ? `"${title}" is now public on Vera Market.` : `"${title}" was not approved. Please review it and submit an updated version.` } }),
    prisma.auditLog.create({ data: { actorId: session.user.id, action: `CONTENT_${decision}`, targetType, targetId, metadata: { title } } }),
  ]);
  if (decision === "APPROVE" && targetType !== "SHOP") {
    await safeNotify(() => notifyContentPublished(targetType, targetId));
  }
  return NextResponse.json({ targetType, targetId, status });
}
