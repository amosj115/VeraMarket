import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";

const SEARCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_SCAN_LIMIT = 5000;

export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  imageUrl?: string | null;
  dedupeKey?: string;
  relatedListingId?: string;
  relatedSellerId?: string;
  relatedShopId?: string;
  relatedSearchId?: string;
  relatedServiceId?: string;
  relatedPropertyId?: string;
};

// skipDuplicates relies on the (userId, dedupeKey) unique index, so repeated triggers are no-ops.
export async function createNotifications(rows: NotificationInput[]) {
  if (!rows.length) return 0;
  const result = await prisma.notification.createMany({ data: rows as Prisma.NotificationCreateManyInput[], skipDuplicates: true });
  return result.count;
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function queryMatches(query: string, text: string) {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length || tokens.some((token) => token.startsWith("category:"))) return false;
  const haystack = normalize(text);
  return tokens.every((token) => haystack.includes(token));
}

function sameArea(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const left = normalize(a);
  const right = normalize(b);
  if (left.length < 3 || right.length < 3) return false;
  return left.includes(right) || right.includes(left);
}

type SearchMatchTarget = {
  text: string;
  location: string;
  excludeUserIds: string[];
};

// One match per user, using only searches inside the 7 day relevance window.
async function findSearchMatches({ text, location, excludeUserIds }: SearchMatchTarget) {
  const since = new Date(Date.now() - SEARCH_WINDOW_MS);
  const rows = await prisma.searchActivity.findMany({
    where: { userId: { not: null, notIn: excludeUserIds }, createdAt: { gte: since }, NOT: { query: { startsWith: "category:" } } },
    orderBy: { createdAt: "desc" },
    take: SEARCH_SCAN_LIMIT,
    select: { id: true, userId: true, query: true, user: { select: { location: true, status: true } } },
  });
  const matches = new Map<string, { searchId: string; query: string; userLocation: string | null; local: boolean }>();
  for (const row of rows) {
    if (!row.userId || matches.has(row.userId) || row.user?.status !== "ACTIVE") continue;
    if (!queryMatches(row.query, text)) continue;
    matches.set(row.userId, { searchId: row.id, query: row.query, userLocation: row.user.location, local: sameArea(row.user.location, location) });
  }
  return matches;
}

function searchMatchCopy(title: string, match: { userLocation: string | null; local: boolean }, noun: string) {
  if (match.local && match.userLocation) {
    return { title: "New match for your recent search", body: `"${title}" was just listed near ${match.userLocation}.` };
  }
  return { title: "New match for your recent search", body: `A new ${noun} matching your recent search was just listed: "${title}".` };
}

export type PublishedKind = "LISTING" | "SERVICE" | "PROPERTY" | "SHOP_PRODUCT";

// Call when content becomes publicly visible; safe to call repeatedly because of dedupeKey.
export async function notifyContentPublished(kind: PublishedKind, id: string) {
  if (kind === "LISTING") return notifyListing(id);
  if (kind === "SERVICE") return notifyService(id);
  if (kind === "PROPERTY") return notifyProperty(id);
  return notifyShopProduct(id);
}

async function followerIds(sellerId: string) {
  const rows = await prisma.sellerFollow.findMany({ where: { sellerId }, select: { followerId: true } });
  return rows.map((row) => row.followerId);
}

async function notifyListing(id: string) {
  const listing = await prisma.listing.findFirst({
    where: { id, status: "ACTIVE" },
    select: { id: true, slug: true, title: true, priceCents: true, location: true, sellerId: true, category: { select: { name: true } }, seller: { select: { displayName: true } }, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
  });
  if (!listing) return 0;
  const link = `/listing/${listing.slug}`;
  const imageUrl = listing.images[0]?.url ?? null;
  const dedupeKey = `published:listing:${listing.id}`;
  const followers = (await followerIds(listing.sellerId)).filter((userId) => userId !== listing.sellerId);
  const rows: NotificationInput[] = followers.map((userId) => ({
    userId, type: "FOLLOWED_SELLER_LISTING", title: `New listing from ${listing.seller.displayName}`,
    body: `${listing.seller.displayName} posted ${listing.title} for ${formatZAR(listing.priceCents)}.`,
    link, imageUrl, dedupeKey, relatedListingId: listing.id, relatedSellerId: listing.sellerId,
  }));
  const matches = await findSearchMatches({ text: `${listing.title} ${listing.category.name}`, location: listing.location, excludeUserIds: [listing.sellerId, ...followers] });
  for (const [userId, match] of matches) {
    rows.push({ userId, type: "SEARCH_MATCH", ...searchMatchCopy(listing.title, match, "listing"), link, imageUrl, dedupeKey, relatedListingId: listing.id, relatedSellerId: listing.sellerId, relatedSearchId: match.searchId });
  }
  const created = await createNotifications(rows);
  const { notifySavedSearchMatches } = await import("@/lib/saved-searches");
  return created + (await notifySavedSearchMatches(listing.id));
}

async function notifyService(id: string) {
  const service = await prisma.serviceListing.findFirst({
    where: { id, status: "ACTIVE" },
    select: { id: true, slug: true, title: true, providerId: true, provider: { select: { displayName: true } }, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
  });
  if (!service) return 0;
  const followers = (await followerIds(service.providerId)).filter((userId) => userId !== service.providerId);
  return createNotifications(followers.map((userId) => ({
    userId, type: "SERVICE_UPDATE", title: `New service from ${service.provider.displayName}`,
    body: `${service.provider.displayName} is now offering ${service.title}.`,
    link: `/services/${service.slug}`, imageUrl: service.images[0]?.url ?? null,
    dedupeKey: `published:service:${service.id}`, relatedServiceId: service.id, relatedSellerId: service.providerId,
  })));
}

async function notifyProperty(id: string) {
  const property = await prisma.propertyListing.findFirst({
    where: { id, status: "ACTIVE" },
    select: { id: true, slug: true, title: true, priceCents: true, location: true, ownerId: true, owner: { select: { displayName: true } }, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
  });
  if (!property) return 0;
  const link = `/real-estate/${property.slug}`;
  const imageUrl = property.images[0]?.url ?? null;
  const dedupeKey = `published:property:${property.id}`;
  const followers = (await followerIds(property.ownerId)).filter((userId) => userId !== property.ownerId);
  const rows: NotificationInput[] = followers.map((userId) => ({
    userId, type: "REAL_ESTATE_UPDATE", title: `New property from ${property.owner.displayName}`,
    body: `${property.owner.displayName} listed ${property.title} for ${formatZAR(property.priceCents)}.`,
    link, imageUrl, dedupeKey, relatedPropertyId: property.id, relatedSellerId: property.ownerId,
  }));
  const matches = await findSearchMatches({ text: `${property.title} ${property.location}`, location: property.location, excludeUserIds: [property.ownerId, ...followers] });
  for (const [userId, match] of matches) {
    rows.push({ userId, type: "REAL_ESTATE_UPDATE", ...searchMatchCopy(property.title, match, "property"), link, imageUrl, dedupeKey, relatedPropertyId: property.id, relatedSellerId: property.ownerId, relatedSearchId: match.searchId });
  }
  return createNotifications(rows);
}

async function notifyShopProduct(id: string) {
  const product = await prisma.shopProduct.findFirst({
    where: { id, isAvailable: true, shop: { status: "ACTIVE", isPaused: false, subscriptionStatus: "ACTIVE" } },
    select: { id: true, name: true, priceCents: true, shop: { select: { id: true, slug: true, name: true, ownerId: true } }, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
  });
  if (!product) return 0;
  const followers = await prisma.shopFollower.findMany({ where: { shopId: product.shop.id, userId: { not: product.shop.ownerId } }, select: { userId: true } });
  return createNotifications(followers.map(({ userId }) => ({
    userId, type: "SHOP_UPDATE" as const, title: `New in ${product.shop.name}`,
    body: `${product.name} was added for ${formatZAR(product.priceCents)}.`,
    link: `/shops/${product.shop.slug}`, imageUrl: product.images[0]?.url ?? null,
    dedupeKey: `published:shop-product:${product.id}`, relatedShopId: product.shop.id, relatedSellerId: product.shop.ownerId,
  })));
}

// Saved/liked listing price drop or rise; keyed on the new price so each change notifies once.
export async function notifyPriceChange(listingId: string, oldCents: number, newCents: number) {
  if (oldCents === newCents) return 0;
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, status: "ACTIVE" },
    select: { id: true, slug: true, title: true, sellerId: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
  });
  if (!listing) return 0;
  const [favorites, likes] = await Promise.all([
    prisma.favorite.findMany({ where: { listingId }, select: { userId: true } }),
    prisma.listingLike.findMany({ where: { listingId }, select: { userId: true } }),
  ]);
  const userIds = [...new Set([...favorites, ...likes].map((row) => row.userId))].filter((userId) => userId !== listing.sellerId);
  return createNotifications(userIds.map((userId) => ({
    userId, type: "PRICE_CHANGE" as const, title: newCents < oldCents ? "Price dropped" : "Price changed",
    body: `"${listing.title}" changed from ${formatZAR(oldCents)} to ${formatZAR(newCents)}.`,
    link: `/listing/${listing.slug}`, imageUrl: listing.images[0]?.url ?? null,
    dedupeKey: `price:${listing.id}:${newCents}`, relatedListingId: listing.id, relatedSellerId: listing.sellerId,
  })));
}

// Notification fan-out must never fail the request that triggered it.
export async function safeNotify(task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.error("[notifications] fan-out failed", error);
  }
}

export function serializeNotification(n: { id: string; type: NotificationType; title: string; body: string; link: string | null; imageUrl: string | null; readAt: Date | null; createdAt: Date }) {
  return { id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, imageUrl: n.imageUrl, isRead: n.readAt !== null, createdAt: n.createdAt.toISOString() };
}

// Tells everyone who saved a listing when it sells or is withdrawn.
export async function notifyWishlistStatus(listingId: string, status: "SOLD" | "REMOVED") {
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true, slug: true, title: true, sellerId: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } });
  if (!listing) return 0;
  const favorites = await prisma.favorite.findMany({ where: { listingId, userId: { not: listing.sellerId } }, select: { userId: true } });
  return createNotifications(favorites.map(({ userId }) => ({
    userId, type: "WISHLIST_UPDATE" as const,
    title: status === "SOLD" ? "A saved item was sold" : "A saved item is no longer available",
    body: status === "SOLD" ? `"${listing.title}" has been sold.` : `"${listing.title}" was removed by the seller.`,
    link: `/profile/saved`, imageUrl: listing.images[0]?.url ?? null, dedupeKey: `wishlist:${status}:${listing.id}`, relatedListingId: listing.id,
  })));
}