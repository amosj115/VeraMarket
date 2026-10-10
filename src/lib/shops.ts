import { prisma } from "@/lib/prisma";

type ShopLike = {
  status: string;
  isPaused: boolean;
  subscriptionStatus?: string;
  subscription?: { status: string; expiresAt: Date | null } | null;
};

/**
 * A Virtual Store is publicly visible only when it is approved (status ACTIVE),
 * not paused, and its R59/month subscription is paid (subscriptionStatus ACTIVE),
 * still marked ACTIVE, and not past its expiry. Every public query, badge and
 * boost decision must use this filter so an expired subscription stops providing
 * benefits immediately, not only after the expiry cron has run.
 */
export function activeShopFilter(now: Date = new Date()) {
  return {
    status: "ACTIVE" as const,
    isPaused: false,
    subscriptionStatus: "ACTIVE" as const,
    subscription: { is: { status: "ACTIVE" as const, expiresAt: { gt: now } } },
  };
}

/** Read-side twin of activeShopFilter for a shop row already fetched with its subscription. */
export function isShopVisible(shop: ShopLike, now: Date = new Date()): boolean {
  if (shop.status !== "ACTIVE" || shop.isPaused) return false;
  if (shop.subscriptionStatus !== undefined && shop.subscriptionStatus !== "ACTIVE") return false;
  return shop.subscription?.status === "ACTIVE" && !!shop.subscription.expiresAt && shop.subscription.expiresAt > now;
}

/**
 * Derived subscription state for seller dashboards: whether the store is currently
 * paid for and whether it sits inside the 7-day early-renewal window. Lives here so
 * components never call Date.now during render (React Compiler purity rule).
 */
export function subscriptionState(subscription: { status: string; expiresAt: Date | null } | null | undefined, now: Date = new Date()) {
  const active = subscription?.status === "ACTIVE" && !!subscription.expiresAt && subscription.expiresAt > now;
  const renewingSoon = active && !!subscription.expiresAt && subscription.expiresAt.getTime() - now.getTime() <= 7 * 24 * 60 * 60 * 1000;
  return { active, renewingSoon };
}

export type ActiveStore = { id: string; slug: string; name: string };

/**
 * Every publicly visible store keyed by its owner id, so marketplace listings can
 * show the 🏪 badge and receive the 25% baseline boost while the owner's
 * subscription is active. Owners with several stores keep the first one found.
 */
export async function activeStoreOwners(now: Date = new Date()): Promise<Map<string, ActiveStore>> {
  const shops = await prisma.shop.findMany({ where: activeShopFilter(now), select: { ownerId: true, id: true, slug: true, name: true }, orderBy: { createdAt: "asc" } });
  const map = new Map<string, ActiveStore>();
  for (const shop of shops) if (!map.has(shop.ownerId)) map.set(shop.ownerId, { id: shop.id, slug: shop.slug, name: shop.name });
  return map;
}

/** The seller's visible store, used on listing pages for the Visit Store link. */
export async function activeStoreForSeller(sellerId: string, now: Date = new Date()): Promise<ActiveStore | null> {
  const shop = await prisma.shop.findFirst({ where: { ownerId: sellerId, ...activeShopFilter(now) }, select: { id: true, slug: true, name: true }, orderBy: { createdAt: "asc" } });
  return shop ? { id: shop.id, slug: shop.slug, name: shop.name } : null;
}
