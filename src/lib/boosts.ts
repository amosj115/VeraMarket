import { prisma } from "@/lib/prisma";
import { BOOST_PRICING_ZAR_CENTS } from "@/lib/config";

const STARTERS = [
  { key: "boost-1d", name: "Quick Boost", description: "1 day of top placement.", priceCents: BOOST_PRICING_ZAR_CENTS.ONE_DAY, durationDays: 1, priority: 1 },
  { key: "boost-3d", name: "Weekend Boost", description: "3 days of top placement.", priceCents: BOOST_PRICING_ZAR_CENTS.THREE_DAYS, durationDays: 3, priority: 2 },
  { key: "boost-7d", name: "Weekly Boost", description: "7 days of top placement.", priceCents: BOOST_PRICING_ZAR_CENTS.SEVEN_DAYS, durationDays: 7, priority: 3 },
  { key: "boost-30d", name: "Monthly Boost", description: "30 days of top placement.", priceCents: BOOST_PRICING_ZAR_CENTS.THIRTY_DAYS, durationDays: 30, priority: 4 },
];

// Starter prices only seed an empty table; after that, admins own the packages and prices in the database.
export async function ensureBoostPackages() {
  if (await prisma.boostPackage.count()) return;
  await prisma.boostPackage.createMany({ data: STARTERS, skipDuplicates: true });
}

export async function listBoostPackages() {
  await ensureBoostPackages();
  return prisma.boostPackage.findMany({ where: { enabled: true }, orderBy: { priceCents: "asc" } });
}

export function durationEnum(days: number) {
  return days <= 1 ? "ONE_DAY" : days <= 3 ? "THREE_DAYS" : days <= 7 ? "SEVEN_DAYS" : "THIRTY_DAYS";
}

// listingId -> highest active boost priority
export async function activeListingBoosts(): Promise<Map<string, number>> {
  const rows = await prisma.boost.findMany({ where: { status: "ACTIVE", targetType: "LISTING", listingId: { not: null }, expiresAt: { gt: new Date() } }, select: { listingId: true, priority: true } });
  const map = new Map<string, number>();
  for (const row of rows) if (row.listingId) map.set(row.listingId, Math.max(map.get(row.listingId) ?? 0, row.priority));
  return map;
}

export async function boostAnalytics(boost: { listingId: string | null; startsAt: Date | null; expiresAt: Date | null }) {
  if (!boost.listingId || !boost.startsAt) return null;
  const until = boost.expiresAt && boost.expiresAt < new Date() ? boost.expiresAt : new Date();
  const range = { gte: boost.startsAt, lte: until };
  const [engagement, saves, conversations, offers] = await Promise.all([
    prisma.listingEngagement.groupBy({ by: ["type"], where: { listingId: boost.listingId, createdAt: range }, _count: { _all: true } }),
    prisma.favorite.count({ where: { listingId: boost.listingId, createdAt: range } }),
    prisma.conversation.count({ where: { listingId: boost.listingId, createdAt: range } }),
    prisma.offer.count({ where: { listingId: boost.listingId, createdAt: range, parentOfferId: null } }),
  ]);
  const by = (type: string) => engagement.find((row) => row.type === type)?._count._all ?? 0;
  return { views: by("VIEW"), shares: by("SHARE"), contacts: by("CONTACT"), saves, conversations, offers };
}