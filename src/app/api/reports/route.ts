import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { reportSchema } from "@/lib/validation/report";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid report" }, { status: 400 });
  const { targetType, targetId, reason, details } = parsed.data;
  const targetField = { LISTING: "listingId", SHOP: "shopId", SERVICE: "serviceId", PROPERTY: "propertyId", USER: "reportedUserId" }[targetType] as "listingId" | "shopId" | "serviceId" | "propertyId" | "reportedUserId";
  if (targetType === "USER" && targetId === session.user.id) return NextResponse.json({ error: "You cannot report yourself" }, { status: 400 });
  const targetExists = targetType === "USER" ? await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } }) : targetType === "LISTING" ? await prisma.listing.findUnique({ where: { id: targetId }, select: { id: true } }) : targetType === "SHOP" ? await prisma.shop.findUnique({ where: { id: targetId }, select: { id: true } }) : targetType === "SERVICE" ? await prisma.serviceListing.findUnique({ where: { id: targetId }, select: { id: true } }) : await prisma.propertyListing.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!targetExists) return NextResponse.json({ error: "Content not found" }, { status: 404 });
  const report = await prisma.report.create({ data: { reporterId: session.user.id, targetType, reason, details, [targetField]: targetId }, select: { id: true, status: true } });
  return NextResponse.json({ report }, { status: 201 });
}
