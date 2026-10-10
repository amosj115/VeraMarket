import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeListingBoosts } from "@/lib/boosts";
import { createNotifications } from "@/lib/notifications";

const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 12;
const CANDIDATE_LIMIT = 300;

type EventType = "VIEW" | "SHARE" | "CONTACT";
type EventCounts = Map<string, Map<EventType, number>>;

function countsByListing(rows: { listingId: string; type: EventType; _count: { _all: number } }[]): EventCounts {
  const counts: EventCounts = new Map();
  for (const row of rows) {
    const listingCounts = counts.get(row.listingId) ?? new Map<EventType, number>();
    listingCounts.set(row.type, row._count._all);
    counts.set(row.listingId, listingCounts);
  }
  return counts;
}

function value(counts: EventCounts, listingId: string, type: EventType) {
  return counts.get(listingId)?.get(type) ?? 0;
}

function queryMatches(query: string, title: string, category: string) {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter((term) => term.length > 2);
  if (!terms.length) return false;
  const text = `${title} ${category}`.toLocaleLowerCase();
  return terms.some((term) => text.includes(term));
}

export type TrendingItem = {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
  location: string;
  createdAt: Date;
  category: { name: string; slug: string };
  images: { url: string }[];
  seller: { displayName: string; username: string; identityVerification: string };
  likeCount: number;
  saveCount: number;
  liked: boolean;
  saved: boolean;
  labels: string[];
};

export async function getTrendingPage(userId?: string, requestedOffset = 0) {
  const offset = Math.max(0, Math.floor(requestedOffset));
  const now = Date.now();
  const dayAgo = new Date(now - DAY);
  const weekAgo = new Date(now - 7 * DAY);
  const monthAgo = new Date(now - 30 * DAY);

  const [recentEvents, weekEvents, recentLikes, weekLikes, recentSaves, weekSaves, user, userSearches, searches, categorySearches] = await Promise.all([
    prisma.listingEngagement.groupBy({ by: ["listingId", "type"], where: { createdAt: { gte: dayAgo } }, _count: { _all: true }, take: 600, orderBy: { _count: { id: "desc" } } }),
    prisma.listingEngagement.groupBy({ by: ["listingId", "type"], where: { createdAt: { gte: weekAgo } }, _count: { _all: true }, take: 600, orderBy: { _count: { id: "desc" } } }),
    prisma.listingLike.groupBy({ by: ["listingId"], where: { createdAt: { gte: dayAgo } }, _count: { _all: true }, take: CANDIDATE_LIMIT, orderBy: { _count: { listingId: "desc" } } }),
    prisma.listingLike.groupBy({ by: ["listingId"], where: { createdAt: { gte: weekAgo } }, _count: { _all: true }, take: CANDIDATE_LIMIT, orderBy: { _count: { listingId: "desc" } } }),
    prisma.favorite.groupBy({ by: ["listingId"], where: { listingId: { not: null }, createdAt: { gte: dayAgo } }, _count: { _all: true }, take: CANDIDATE_LIMIT, orderBy: { _count: { listingId: "desc" } } }),
    prisma.favorite.groupBy({ by: ["listingId"], where: { listingId: { not: null }, createdAt: { gte: weekAgo } }, _count: { _all: true }, take: CANDIDATE_LIMIT, orderBy: { _count: { listingId: "desc" } } }),
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { location: true } }) : null,
    userId ? prisma.searchActivity.findMany({ where: { userId, createdAt: { gte: monthAgo } }, orderBy: { createdAt: "desc" }, take: 20, select: { query: true, categorySlug: true } }) : [],
    prisma.searchActivity.groupBy({ by: ["query"], where: { createdAt: { gte: weekAgo } }, _count: { _all: true }, take: 100, orderBy: { _count: { query: "desc" } } }),
    prisma.searchActivity.groupBy({ by: ["categorySlug"], where: { categorySlug: { not: null }, createdAt: { gte: weekAgo } }, _count: { _all: true }, take: 50, orderBy: { _count: { categorySlug: "desc" } } }),
  ]);

  const recentEventCounts = countsByListing(recentEvents);
  const weekEventCounts = countsByListing(weekEvents);
  const recentLikeCounts = new Map(recentLikes.map((row) => [row.listingId, row._count._all]));
  const weekLikeCounts = new Map(weekLikes.map((row) => [row.listingId, row._count._all]));
  const recentSaveCounts = new Map(recentSaves.flatMap((row) => row.listingId ? [[row.listingId, row._count._all] as const] : []));
  const weekSaveCounts = new Map(weekSaves.flatMap((row) => row.listingId ? [[row.listingId, row._count._all] as const] : []));

  const candidateIds = new Set<string>();
  for (const rows of [recentEvents, weekEvents, recentLikes, weekLikes, recentSaves, weekSaves]) {
    for (const row of rows) if (row.listingId) candidateIds.add(row.listingId);
  }
  const boosts = await activeListingBoosts();
  for (const boostedId of boosts.keys()) candidateIds.add(boostedId);
  const matchingQueries = [...new Set([...userSearches.map((row) => row.query), ...searches.map((row) => row.query)])]
    .filter((query) => query.length > 2 && !query.startsWith("category:"))
    .slice(0, 30);
  const popularCategorySlugs = categorySearches.flatMap((row) => row.categorySlug ? [row.categorySlug] : []);
  const discoveryFilters: Prisma.ListingWhereInput[] = [];
  if (candidateIds.size) discoveryFilters.push({ id: { in: [...candidateIds] } });
  for (const query of matchingQueries) {
    discoveryFilters.push({ title: { contains: query, mode: "insensitive" } });
  }
  if (popularCategorySlugs.length) discoveryFilters.push({ category: { slug: { in: popularCategorySlugs } } });

  const candidates = await prisma.listing.findMany({
    where: { status: "ACTIVE", ...(discoveryFilters.length ? { OR: discoveryFilters } : {}) },
    orderBy: { createdAt: "desc" },
    take: CANDIDATE_LIMIT,
    include: {
      images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
      category: { select: { name: true, slug: true } },
      seller: { select: { displayName: true, username: true, identityVerification: true } },
      _count: { select: { likes: true, favorites: true } },
    },
  });

  const categoryMomentum = new Map<string, number>();
  for (const listing of candidates) {
    const views = value(recentEventCounts, listing.id, "VIEW");
    const shares = value(recentEventCounts, listing.id, "SHARE");
    const contacts = value(recentEventCounts, listing.id, "CONTACT");
    const activity = views + shares * 3 + contacts * 5 + (recentLikeCounts.get(listing.id) ?? 0) * 4 + (recentSaveCounts.get(listing.id) ?? 0) * 5;
    categoryMomentum.set(listing.category.slug, (categoryMomentum.get(listing.category.slug) ?? 0) + activity);
  }
  for (const row of categorySearches) {
    if (row.categorySlug) categoryMomentum.set(row.categorySlug, (categoryMomentum.get(row.categorySlug) ?? 0) + row._count._all * 3);
  }

  const ranked = candidates.map((listing) => {
    const recentViews = value(recentEventCounts, listing.id, "VIEW");
    const weekViews = value(weekEventCounts, listing.id, "VIEW");
    const recentShares = value(recentEventCounts, listing.id, "SHARE");
    const weekShares = value(weekEventCounts, listing.id, "SHARE");
    const recentContacts = value(recentEventCounts, listing.id, "CONTACT");
    const weekContacts = value(weekEventCounts, listing.id, "CONTACT");
    const recentLikeCount = recentLikeCounts.get(listing.id) ?? 0;
    const weekLikeCount = weekLikeCounts.get(listing.id) ?? 0;
    const recentSaveCount = recentSaveCounts.get(listing.id) ?? 0;
    const weekSaveCount = weekSaveCounts.get(listing.id) ?? 0;
    const recentScore = recentViews + recentShares * 3 + recentContacts * 5 + recentLikeCount * 4 + recentSaveCount * 5;
    const olderScore = Math.max(0, weekViews - recentViews) * 0.2 + Math.max(0, weekShares - recentShares) * 0.6 + Math.max(0, weekContacts - recentContacts) + Math.max(0, weekLikeCount - recentLikeCount) * 1.2 + Math.max(0, weekSaveCount - recentSaveCount) * 1.5;
    const matchingUserSearch = userSearches.find((row) => !row.query.startsWith("category:") && queryMatches(row.query, listing.title, listing.category.name));
    const matchingGlobalSearches = searches.filter((row) => !row.query.startsWith("category:") && queryMatches(row.query, listing.title, listing.category.name));
    const local = Boolean(user?.location && listing.location.toLocaleLowerCase().includes(user.location.toLocaleLowerCase()));
    const ageInDays = (now - listing.createdAt.getTime()) / DAY;
    let score = recentScore + olderScore + Math.min(recentScore / Math.max(olderScore, 1), 5) + Math.max(0, 30 - ageInDays) / 10;
    score += matchingUserSearch ? 5 : 0;
    score += matchingGlobalSearches.reduce((sum, row) => sum + Math.min(row._count._all, 20) * 0.3, 0);
    score += (categoryMomentum.get(listing.category.slug) ?? 0) * 0.1;
    score += local ? 4 : 0;
    score += (boosts.get(listing.id) ?? 0) * 3;

    const labels: string[] = [];
    if (boosts.has(listing.id)) labels.push("Boosted");
    if (recentScore >= 10) labels.push("Trending now");
    else if (recentScore >= 5 && recentScore > olderScore) labels.push("Rising fast");
    if (local && recentScore >= 1) labels.push("Trending near you");
    if (matchingUserSearch) labels.push(`Because you searched for ${matchingUserSearch.query}`);
    if ((categoryMomentum.get(listing.category.slug) ?? 0) >= 12) labels.push(`Popular in ${listing.category.name}`);

    return { listing, score, labels };
  }).sort((a, b) => b.score - a.score || b.listing.createdAt.getTime() - a.listing.createdAt.getTime());

  const page = ranked.slice(offset, offset + PAGE_SIZE);
  const pageIds = page.map(({ listing }) => listing.id);
  const [likedIds, savedIds] = userId && pageIds.length ? await Promise.all([
    prisma.listingLike.findMany({ where: { userId, listingId: { in: pageIds } }, select: { listingId: true } }),
    prisma.favorite.findMany({ where: { userId, listingId: { in: pageIds } }, select: { listingId: true } }),
  ]) : [[], []];
  const liked = new Set(likedIds.map((row) => row.listingId));
  const saved = new Set(savedIds.map((row) => row.listingId));

  const items: TrendingItem[] = page.map(({ listing, labels }) => ({
    id: listing.id,
    title: listing.title,
    slug: listing.slug,
    priceCents: listing.priceCents,
    location: listing.location,
    createdAt: listing.createdAt,
    category: listing.category,
    images: listing.images,
    seller: listing.seller,
    likeCount: listing._count.likes,
    saveCount: listing._count.favorites,
    liked: liked.has(listing.id),
    saved: saved.has(listing.id),
    labels: labels.slice(0, 2),
  }));

  return { items, hasMore: offset + page.length < ranked.length, nextOffset: offset + page.length };
}

const NOTIFY_COOLDOWN_MS = 7 * DAY;
const SEARCH_LOOKBACK_MS = 30 * DAY;
const TRENDING_LABELS = ["Trending now", "Rising fast"];

// Trending notifications are automatic for every eligible (ACTIVE) user: there is no
// opt-in. Runs from the scheduler-only /api/trending/notify endpoint, so generation
// never depends on a user visiting the marketplace or clicking anything.
//
// Spam protection (two layers, both reusing existing mechanisms):
//  1. one notification per user per 7 days (the cadence the old opt-in feature had);
//  2. dedupeKey "trending:<listingId>" on the (userId, dedupeKey) unique index, so the
//     same user can never receive a duplicate for the same trending listing even if the
//     job runs twice concurrently (createMany skips duplicates).
export async function notifyTrendingMatches() {
  const page = await getTrendingPage();
  const trendingItems = page.items.filter((item) => item.labels.some((label) => TRENDING_LABELS.includes(label)));
  if (!trendingItems.length) return 0;

  const userIds = (await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true } })).map((row) => row.id);
  if (!userIds.length) return 0;

  const [recentMatches, searches] = await Promise.all([
    prisma.notification.findMany({ where: { type: "TRENDING_MATCH", userId: { in: userIds }, createdAt: { gte: new Date(Date.now() - NOTIFY_COOLDOWN_MS) } }, select: { userId: true } }),
    prisma.searchActivity.findMany({ where: { userId: { in: userIds }, createdAt: { gte: new Date(Date.now() - SEARCH_LOOKBACK_MS) }, NOT: { query: { startsWith: "category:" } } }, take: 5000, select: { userId: true, query: true } }),
  ]);
  const onCooldown = new Set(recentMatches.map((row) => row.userId));
  const queriesByUser = new Map<string, string[]>();
  for (const row of searches) {
    if (!row.userId) continue;
    queriesByUser.set(row.userId, [...(queriesByUser.get(row.userId) ?? []), row.query]);
  }

  const top = trendingItems[0];
  const rows = userIds.filter((userId) => !onCooldown.has(userId)).map((userId) => {
    const queries = queriesByUser.get(userId) ?? [];
    const matched = trendingItems.find((item) => queries.some((query) => queryMatches(query, item.title, item.category.name)));
    const item = matched ?? top;
    const query = matched ? queries.find((candidate) => queryMatches(candidate, matched.title, matched.category.name)) : undefined;
    return {
      userId,
      type: "TRENDING_MATCH" as const,
      title: "New listings are trending",
      body: query
        ? `"${item.title}" is trending and matches your recent search for "${query}".`
        : `"${item.title}" is gaining attention on Vera Market right now.`,
      link: "/trending",
      dedupeKey: `trending:${item.id}`,
      relatedListingId: item.id,
    };
  });

  return createNotifications(rows);
}