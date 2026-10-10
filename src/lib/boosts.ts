import { prisma } from "@/lib/prisma";
import { BOOST_PRICING_ZAR_CENTS, BOOST_VISIBILITY_PRICING_ZAR_CENTS } from "@/lib/config";

const STARTERS = [
  { key: "boost-1d", name: "Quick Boost", description: "1 day of top placement.", priceCents: BOOST_PRICING_ZAR_CENTS.ONE_DAY, durationDays: 1, priority: 1 },
  { key: "boost-3d", name: "Weekend Boost", description: "3 days of top placement.", priceCents: BOOST_PRICING_ZAR_CENTS.THREE_DAYS, durationDays: 3, priority: 2 },
  { key: "boost-7d", name: "Weekly Boost", description: "7 days of top placement.", priceCents: BOOST_PRICING_ZAR_CENTS.SEVEN_DAYS, durationDays: 7, priority: 3 },
  { key: "boost-30d", name: "Monthly Boost", description: "30 days of top placement.", priceCents: BOOST_PRICING_ZAR_CENTS.THIRTY_DAYS, durationDays: 30, priority: 4 },
  // Percent-level boosts. The priority doubles as the visibility weight used when
  // ordering marketplace results (100 > 50 > 25 store baseline > organic). Price 0
  // = not priced yet; purchases are rejected until a price is set (see config.ts).
  { key: "boost-visibility-50", name: "50% Visibility Boost", description: "7 days above Virtual Store listings in search results.", priceCents: BOOST_VISIBILITY_PRICING_ZAR_CENTS.FIFTY_PERCENT, durationDays: 7, priority: 50 },
  { key: "boost-visibility-100", name: "100% Visibility Boost", description: "7 days of the highest placement in search results.", priceCents: BOOST_VISIBILITY_PRICING_ZAR_CENTS.ONE_HUNDRED_PERCENT, durationDays: 7, priority: 100 },
];

// The baseline every listing of an active Virtual Store receives, expressed in the
// same visibility-weight scale as paid packages (percent).
export const STORE_BASELINE_VISIBILITY = 25;

// Seed only packages that do not exist yet; never overwrite a package an admin has
// priced in the database. The price in config.ts is a seed default for fresh envs.
export async function ensureBoostPackages() {
  const existing = await prisma.boostPackage.findMany({ select: { key: true } });
  const present = new Set(existing.map((row) => row.key));
  const missing = STARTERS.filter((row) => !present.has(row.key));
  if (missing.length) await prisma.boostPackage.createMany({ data: missing, skipDuplicates: true });
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

/**
 * Effective placement weight for one listing: the higher of its active paid boost
 * (duration packages use priority 1-4, percent packages 50 or 100) and the 25%
 * Virtual Store baseline while the seller's subscription is active. Boosts never
 * stack — a store listing with a 50% boost weighs 50, not 75.
 */
export function listingWeight(paidPriority: number | undefined, hasActiveStore: boolean): number {
  return Math.max(paidPriority ?? 0, hasActiveStore ? STORE_BASELINE_VISIBILITY : 0);
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