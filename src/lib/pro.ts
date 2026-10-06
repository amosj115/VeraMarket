import { prisma } from "@/lib/prisma";

export type ProFeatures = { savedSearchLimit: number; advancedAnalytics: boolean };

// A starter plan is created once if the table is empty; admins then own the price and features.
export async function ensureProPlan() {
  if (await prisma.proPlan.count()) return;
  await prisma.proPlan.create({ data: { key: "vera-pro-monthly", name: "Vera Pro", priceCents: 9900, features: { savedSearchLimit: 100, advancedAnalytics: true } } });
}

export async function getProPlan() {
  await ensureProPlan();
  return prisma.proPlan.findFirst({ where: { enabled: true }, orderBy: { priceCents: "asc" } });
}

export async function activePro(userId: string) {
  return prisma.proSubscription.findFirst({ where: { userId, status: "ACTIVE", currentPeriodEnd: { gt: new Date() } }, include: { plan: true }, orderBy: { currentPeriodEnd: "desc" } });
}

export async function proFeatures(userId: string): Promise<ProFeatures | null> {
  const sub = await activePro(userId);
  if (!sub) return null;
  const f = (sub.plan.features ?? {}) as Partial<ProFeatures>;
  return { savedSearchLimit: typeof f.savedSearchLimit === "number" ? f.savedSearchLimit : 0, advancedAnalytics: Boolean(f.advancedAnalytics) };
}