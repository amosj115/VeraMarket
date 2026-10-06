import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { slugify } from "@/lib/utils";
import { createPropertySchema } from "@/lib/validation/property";

export async function GET() { const properties = await prisma.propertyListing.findMany({ where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } }); return NextResponse.json({ properties }); }
export async function POST(request: NextRequest) { const session = await auth(); if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const blocked = await requireVerifiedProfile(session.user.id); if (blocked) return blocked; const parsed = createPropertySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 }); const slug = `${slugify(parsed.data.title)}-${Date.now().toString(36)}`; const property = await prisma.propertyListing.create({ data: { ownerId: session.user.id, slug, title: parsed.data.title, description: parsed.data.description, listingType: parsed.data.listingType, propertyType: parsed.data.propertyType, priceCents: Math.round(parsed.data.priceRand * 100), bedrooms: parsed.data.bedrooms, bathrooms: parsed.data.bathrooms, parkingSpaces: parsed.data.parkingSpaces, floorAreaSqm: parsed.data.floorAreaSqm, landSizeSqm: parsed.data.landSizeSqm, location: parsed.data.location, status: "PENDING_REVIEW" }, select: { id: true, slug: true, status: true } }); return NextResponse.json({ property }, { status: 201 }); }
