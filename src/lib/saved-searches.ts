import { prisma } from "@/lib/prisma";
import { createNotifications } from "@/lib/notifications";

export type SavedSearchSettings = { enabled: boolean; maxPerUser: number };

export async function getSavedSearchSettings(): Promise<SavedSearchSettings> {
  const row = await prisma.siteSetting.findUnique({ where: { key: "saved-search-settings" } }).catch(() => null);
  const value = (row?.value ?? {}) as Partial<SavedSearchSettings>;
  return { enabled: value.enabled ?? true, maxPerUser: typeof value.maxPerUser === "number" && value.maxPerUser > 0 ? value.maxPerUser : 20 };
}

// Notifies owners of saved searches that match a newly published listing; the dedupeKey makes repeat calls no-ops.
export async function notifySavedSearchMatches(listingId: string) {
  const settings = await getSavedSearchSettings();
  if (!settings.enabled) return 0;
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, status: "ACTIVE" },
    select: { id: true, slug: true, title: true, description: true, priceCents: true, condition: true, location: true, sellerId: true, category: { select: { slug: true } }, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
  });
  if (!listing) return 0;
  const searches = await prisma.savedSearch.findMany({
    where: {
      alertsEnabled: true,
      userId: { not: listing.sellerId },
      OR: [{ categorySlug: null }, { categorySlug: listing.category.slug }],
      AND: [{ OR: [{ condition: null }, { condition: listing.condition }] }, { OR: [{ minPriceCents: null }, { minPriceCents: { lte: listing.priceCents } }] }, { OR: [{ maxPriceCents: null }, { maxPriceCents: { gte: listing.priceCents } }] }],
    },
    take: 2000,
  });
  const text = `${listing.title} ${listing.description}`.toLocaleLowerCase();
  const location = listing.location.toLocaleLowerCase();
  const rows = searches
    .filter((search) => (!search.query || search.query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every((token) => text.includes(token))) && (!search.location || location.includes(search.location.toLocaleLowerCase())))
    .map((search) => ({
      userId: search.userId,
      type: "SAVED_SEARCH_MATCH" as const,
      title: `New match for "${search.name}"`,
      body: `${listing.title} was just listed.`,
      link: `/listing/${listing.slug}`,
      imageUrl: listing.images[0]?.url ?? null,
      dedupeKey: `saved-search:${search.id}:${listing.id}`,
      relatedListingId: listing.id,
      relatedSellerId: listing.sellerId,
    }));
  if (!rows.length) return 0;
  await prisma.savedSearch.updateMany({ where: { id: { in: searches.map((s) => s.id) } }, data: { lastNotifiedAt: new Date() } });
  return createNotifications(rows);
}