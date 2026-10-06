import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSavedSearchSettings } from "@/lib/saved-searches";
import { proFeatures } from "@/lib/pro";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.string().trim().max(120).optional(),
  categorySlug: z.string().trim().max(80).optional(),
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR", "FOR_PARTS"]).optional(),
  location: z.string().trim().max(120).optional(),
  minPriceRand: z.coerce.number().min(0).optional(),
  maxPriceRand: z.coerce.number().min(0).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const searches = await prisma.savedSearch.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ searches });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid search" }, { status: 400 });
  const d = parsed.data;
  if (!d.query && !d.categorySlug && !d.condition && !d.location && d.minPriceRand === undefined && d.maxPriceRand === undefined) return NextResponse.json({ error: "Add a keyword or filter before saving a search." }, { status: 400 });
  if (d.minPriceRand !== undefined && d.maxPriceRand !== undefined && d.minPriceRand > d.maxPriceRand) return NextResponse.json({ error: "Minimum price is higher than maximum price." }, { status: 400 });
  const settings = await getSavedSearchSettings();
  const count = await prisma.savedSearch.count({ where: { userId: session.user.id } });
  const pro = await proFeatures(session.user.id);
  const limit = Math.max(settings.maxPerUser, pro?.savedSearchLimit ?? 0);
  if (count >= limit) return NextResponse.json({ error: `You can save up to ${limit} searches. Delete one first${pro ? "" : " or upgrade to Vera Pro for more"}.` }, { status: 409 });
  const search = await prisma.savedSearch.create({
    data: { userId: session.user.id, name: d.name, query: d.query || null, categorySlug: d.categorySlug || null, condition: d.condition ?? null, location: d.location || null, minPriceCents: d.minPriceRand === undefined ? null : Math.round(d.minPriceRand * 100), maxPriceCents: d.maxPriceRand === undefined ? null : Math.round(d.maxPriceRand * 100) },
  });
  return NextResponse.json({ search }, { status: 201 });
}