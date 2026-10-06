import { prisma } from "@/lib/prisma";

export type TrustConfig = {
  verifiedPerson: number;
  emailVerified: number;
  phoneVerified: number;
  accountAgeMax: number;
  accountAgeDays: number;
  perSale: number;
  salesMax: number;
  reviewsMax: number;
  reportPenalty: number;
  reportPenaltyMax: number;
  contactViolationPenalty: number;
  contactViolationPenaltyMax: number;
  newAccountDays: number;
  newAccountFloor: number;
};

export const DEFAULT_TRUST_CONFIG: TrustConfig = {
  verifiedPerson: 25, emailVerified: 5, phoneVerified: 10, accountAgeMax: 10, accountAgeDays: 180,
  perSale: 4, salesMax: 20, reviewsMax: 15, reportPenalty: 5, reportPenaltyMax: 25,
  contactViolationPenalty: 2, contactViolationPenaltyMax: 10, newAccountDays: 30, newAccountFloor: 30,
};

export async function getTrustConfig(): Promise<TrustConfig> {
  const row = await prisma.siteSetting.findUnique({ where: { key: "trust-config" } }).catch(() => null);
  const stored = (row?.value ?? {}) as Partial<Record<keyof TrustConfig, unknown>>;
  const config = { ...DEFAULT_TRUST_CONFIG };
  for (const key of Object.keys(config) as (keyof TrustConfig)[]) {
    const value = stored[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) config[key] = value;
  }
  return config;
}

export type TrustSignal = { label: string; points: number };
export type TrustResult = { score: number; tier: string; signals: TrustSignal[]; stats: UserStats };

export type UserStats = {
  completedSales: number;
  reviewCount: number;
  averageRating: number | null;
  activeListings: number;
  accountAgeDays: number;
  openReports: number;
  contactViolations: number;
  verifiedPerson: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
};

export async function getUserStats(userId: string): Promise<UserStats | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, emailVerifiedAt: true, phoneVerifiedAt: true, profileVerification: true } });
  if (!user) return null;
  const [completedSales, reviews, activeListings, openReports, contactViolations] = await Promise.all([
    prisma.offer.count({ where: { sellerId: userId, status: "COMPLETED" } }),
    prisma.review.aggregate({ where: { subjectId: userId }, _count: { _all: true }, _avg: { rating: true } }),
    prisma.listing.count({ where: { sellerId: userId, status: "ACTIVE" } }),
    prisma.report.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] }, OR: [{ reportedUserId: userId }, { listing: { sellerId: userId } }] } }),
    prisma.contactViolation.count({ where: { userId } }),
  ]);
  return {
    completedSales, reviewCount: reviews._count._all, averageRating: reviews._avg.rating, activeListings,
    accountAgeDays: Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000),
    openReports, contactViolations,
    verifiedPerson: user.profileVerification === "VERIFIED",
    emailVerified: Boolean(user.emailVerifiedAt), phoneVerified: Boolean(user.phoneVerifiedAt),
  };
}

export function scoreTrust(stats: UserStats, config: TrustConfig): TrustResult {
  const signals: TrustSignal[] = [];
  const add = (label: string, points: number) => { if (points !== 0) signals.push({ label, points: Math.round(points) }); };
  if (stats.verifiedPerson) add("Verified person", config.verifiedPerson);
  if (stats.emailVerified) add("Email verified", config.emailVerified);
  if (stats.phoneVerified) add("Phone verified", config.phoneVerified);
  add("Account age", Math.min(stats.accountAgeDays / Math.max(config.accountAgeDays, 1), 1) * config.accountAgeMax);
  add("Completed sales", Math.min(stats.completedSales * config.perSale, config.salesMax));
  if (stats.reviewCount > 0 && stats.averageRating !== null) add("Buyer reviews", (stats.averageRating / 5) * config.reviewsMax * Math.min(stats.reviewCount / 3, 1));
  add("Open reports", -Math.min(stats.openReports * config.reportPenalty, config.reportPenaltyMax));
  add("Contact-sharing attempts in public listings", -Math.min(stats.contactViolations * config.contactViolationPenalty, config.contactViolationPenaltyMax));
  let score = signals.reduce((sum, signal) => sum + signal.points, 0);
  // A brand-new account has no history; that is not evidence of bad behaviour unless there are reports.
  if (stats.accountAgeDays < config.newAccountDays && stats.openReports === 0) score = Math.max(score, config.newAccountFloor);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = score >= 80 ? "Highly trusted" : score >= 60 ? "Trusted" : score >= 40 ? "Building trust" : "New or unproven";
  return { score, tier, signals, stats };
}

export async function getTrust(userId: string): Promise<TrustResult | null> {
  const [stats, config] = await Promise.all([getUserStats(userId), getTrustConfig()]);
  return stats ? scoreTrust(stats, config) : null;
}