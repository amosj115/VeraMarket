import { prisma } from "@/lib/prisma";
import { createNotifications } from "@/lib/notifications";
import { getUserStats, type UserStats } from "@/lib/trust";

export const RULE_TYPES = ["COMPLETED_SALES", "ACTIVE_LISTINGS", "REVIEWS_RECEIVED", "ACCOUNT_AGE_DAYS", "VERIFIED_PERSON", "PHONE_VERIFIED"] as const;
export type RuleType = (typeof RULE_TYPES)[number];

// Starting rules only. Admins can edit, disable or add rules; awards are only ever created from real user data.
const DEFAULTS: { key: string; name: string; description: string; ruleType: RuleType; threshold: number }[] = [
  { key: "verified-person", name: "Verified Person", description: "Completed profile verification.", ruleType: "VERIFIED_PERSON", threshold: 1 },
  { key: "phone-verified", name: "Reachable", description: "Verified your phone number.", ruleType: "PHONE_VERIFIED", threshold: 1 },
  { key: "first-sale", name: "First Sale", description: "Completed your first sale.", ruleType: "COMPLETED_SALES", threshold: 1 },
  { key: "ten-sales", name: "Trusted Seller", description: "Completed 10 sales.", ruleType: "COMPLETED_SALES", threshold: 10 },
  { key: "active-lister", name: "Active Lister", description: "Have 5 active listings.", ruleType: "ACTIVE_LISTINGS", threshold: 5 },
  { key: "well-reviewed", name: "Well Reviewed", description: "Received 5 reviews.", ruleType: "REVIEWS_RECEIVED", threshold: 5 },
  { key: "veteran", name: "Veteran", description: "Member for a year.", ruleType: "ACCOUNT_AGE_DAYS", threshold: 365 },
];

export async function ensureDefaultAchievements() {
  if (await prisma.achievement.count()) return;
  await prisma.achievement.createMany({ data: DEFAULTS, skipDuplicates: true });
}

export function statFor(rule: RuleType, stats: UserStats): number {
  switch (rule) {
    case "COMPLETED_SALES": return stats.completedSales;
    case "ACTIVE_LISTINGS": return stats.activeListings;
    case "REVIEWS_RECEIVED": return stats.reviewCount;
    case "ACCOUNT_AGE_DAYS": return stats.accountAgeDays;
    case "VERIFIED_PERSON": return stats.verifiedPerson ? 1 : 0;
    case "PHONE_VERIFIED": return stats.phoneVerified ? 1 : 0;
  }
}

export async function evaluateAchievements(userId: string) {
  await ensureDefaultAchievements();
  const [stats, rules, owned] = await Promise.all([
    getUserStats(userId),
    prisma.achievement.findMany({ where: { enabled: true } }),
    prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
  ]);
  if (!stats) return [];
  const have = new Set(owned.map((row) => row.achievementId));
  const earned = rules.filter((rule) => !have.has(rule.id) && (RULE_TYPES as readonly string[]).includes(rule.ruleType) && statFor(rule.ruleType as RuleType, stats) >= rule.threshold);
  if (!earned.length) return [];
  await prisma.userAchievement.createMany({ data: earned.map((rule) => ({ userId, achievementId: rule.id })), skipDuplicates: true });
  await createNotifications(earned.map((rule) => ({ userId, type: "ACHIEVEMENT_EARNED" as const, title: `Achievement unlocked: ${rule.name}`, body: rule.description, link: "/dashboard", dedupeKey: `achievement:${rule.id}` })));
  return earned.map((rule) => rule.key);
}

export async function listAchievements(userId: string) {
  await ensureDefaultAchievements();
  const [rules, owned] = await Promise.all([prisma.achievement.findMany({ where: { enabled: true }, orderBy: { threshold: "asc" } }), prisma.userAchievement.findMany({ where: { userId } })]);
  const awarded = new Map(owned.map((row) => [row.achievementId, row.awardedAt]));
  return rules.map((rule) => ({ ...rule, awardedAt: awarded.get(rule.id) ?? null }));
}