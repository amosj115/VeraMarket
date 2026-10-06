import Link from "next/link";
import { Children, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function getAnalyticsWindows() {
  const currentTime = Date.now();
  return {
    dayAgo: new Date(currentTime - 24 * 60 * 60 * 1000),
    twoDaysAgo: new Date(currentTime - 48 * 60 * 60 * 1000),
    weekAgo: new Date(currentTime - 7 * 24 * 60 * 60 * 1000),
  };
}

export default async function AdminTrendingPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const { dayAgo, twoDaysAgo, weekAgo } = getAnalyticsWindows();
  const [searchRows, categorySearches, activityTotals, currentActivity, previousActivity, likes, saves] = await Promise.all([
    prisma.searchActivity.findMany({ where: { createdAt: { gte: weekAgo } }, select: { query: true, userId: true }, take: 10000 }),
    prisma.searchActivity.groupBy({ by: ["categorySlug"], where: { categorySlug: { not: null }, createdAt: { gte: weekAgo } }, _count: { _all: true }, orderBy: { _count: { categorySlug: "desc" } }, take: 20 }),
    prisma.listingEngagement.groupBy({ by: ["type"], where: { createdAt: { gte: weekAgo } }, _count: { _all: true } }),
    prisma.listingEngagement.groupBy({ by: ["listingId"], where: { createdAt: { gte: dayAgo } }, _count: { _all: true }, orderBy: { _count: { listingId: "desc" } }, take: 200 }),
    prisma.listingEngagement.groupBy({ by: ["listingId"], where: { createdAt: { gte: twoDaysAgo, lt: dayAgo } }, _count: { _all: true }, orderBy: { _count: { listingId: "desc" } }, take: 200 }),
    prisma.listingLike.groupBy({ by: ["listingId"], where: { createdAt: { gte: weekAgo } }, _count: { _all: true }, orderBy: { _count: { listingId: "desc" } }, take: 10 }),
    prisma.favorite.groupBy({ by: ["listingId"], where: { listingId: { not: null }, createdAt: { gte: weekAgo } }, _count: { _all: true }, orderBy: { _count: { listingId: "desc" } }, take: 10 }),
  ]);

  const searches = new Map<string, { events: number; users: Set<string> }>();
  for (const row of searchRows) {
    const current = searches.get(row.query) ?? { events: 0, users: new Set<string>() };
    current.events += 1;
    if (row.userId) current.users.add(row.userId);
    searches.set(row.query, current);
  }
  const topSearches = [...searches.entries()]
    .filter(([query]) => !query.startsWith("category:"))
    .filter(([, value]) => value.users.size >= 3)
    .sort((a, b) => b[1].events - a[1].events)
    .slice(0, 10)
    .map(([query, value]) => ({ query, events: value.events, users: value.users.size }));

  const listingIds = [...new Set([
    ...currentActivity.map((row) => row.listingId),
    ...previousActivity.map((row) => row.listingId),
    ...likes.map((row) => row.listingId),
    ...saves.flatMap((row) => row.listingId ? [row.listingId] : []),
  ])];
  const listingRecords = await prisma.listing.findMany({
    where: { id: { in: listingIds } },
    select: { id: true, title: true, slug: true, location: true, category: { select: { name: true, slug: true } } },
  });
  const categories = await prisma.category.findMany({ where: { slug: { in: categorySearches.flatMap((row) => row.categorySlug ? [row.categorySlug] : []) } }, select: { slug: true, name: true } });
  const listingById = new Map(listingRecords.map((listing) => [listing.id, listing]));
  const categoriesBySlug = new Map(categories.map((category) => [category.slug, category]));
  const previousCounts = new Map(previousActivity.map((row) => [row.listingId, row._count._all]));
  const risingListings = currentActivity
    .filter((row) => row._count._all >= 3 && row._count._all > (previousCounts.get(row.listingId) ?? 0) * 1.5)
    .map((row) => ({ listing: listingById.get(row.listingId), count: row._count._all, growth: row._count._all - (previousCounts.get(row.listingId) ?? 0) }))
    .filter((row) => row.listing)
    .sort((a, b) => b.growth - a.growth)
    .slice(0, 10);

  const categoryTotals = new Map<string, { name: string; score: number }>();
  for (const row of categorySearches) {
    if (!row.categorySlug) continue;
    const category = categoriesBySlug.get(row.categorySlug);
    if (category) categoryTotals.set(row.categorySlug, { name: category.name, score: row._count._all });
  }
  for (const row of currentActivity) {
    const listing = listingById.get(row.listingId);
    if (!listing) continue;
    const category = categoryTotals.get(listing.category.slug) ?? { name: listing.category.name, score: 0 };
    category.score += row._count._all;
    categoryTotals.set(listing.category.slug, category);
  }
  const topCategories = [...categoryTotals.values()].sort((a, b) => b.score - a.score).slice(0, 8);

  const locationTotals = new Map<string, number>();
  for (const row of currentActivity) {
    const location = listingById.get(row.listingId)?.location;
    if (location) locationTotals.set(location, (locationTotals.get(location) ?? 0) + row._count._all);
  }
  const topLocations = [...locationTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const activityByType = new Map(activityTotals.map((row) => [row.type, row._count._all]));

  return <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6"><div><p className="text-sm font-medium text-brand">Admin analytics</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Trending activity</h1><p className="mt-2 text-sm text-slate-500">Aggregated marketplace activity from the last seven days.</p></div><Link href="/admin/reports" className="text-sm font-semibold text-brand">Open reports</Link></div>
    <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Views", activityByType.get("VIEW") ?? 0], ["Shares", activityByType.get("SHARE") ?? 0], ["Seller contacts", activityByType.get("CONTACT") ?? 0], ["Search terms", topSearches.length]].map(([label, value]) => <div key={label} className="border-y border-border py-4"><p className="text-2xl font-semibold text-brand">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>)}</section>
    <div className="mt-8 grid gap-8 lg:grid-cols-2">
      <MetricSection title="Trending searches" empty="No search term has enough unique users to display." >{topSearches.map((row) => <li key={row.query} className="flex justify-between gap-3 py-2 text-sm"><span className="truncate">{row.query}</span><span className="shrink-0 text-slate-500">{row.events} searches · {row.users} people</span></li>)}</MetricSection>
      <MetricSection title="Trending categories" empty="Category activity will appear as searches and listings gain engagement.">{topCategories.map((row) => <li key={row.name} className="flex justify-between gap-3 py-2 text-sm"><span>{row.name}</span><span className="text-slate-500">{row.score} signals</span></li>)}</MetricSection>
      <MetricSection title="Fastest-growing listings" empty="No listings have enough recent growth yet.">{risingListings.map(({ listing, count, growth }) => listing && <li key={listing.id} className="flex justify-between gap-3 py-2 text-sm"><Link href={`/listing/${listing.slug}`} className="truncate font-medium text-brand">{listing.title}</Link><span className="shrink-0 text-slate-500">{count} recent · +{growth}</span></li>)}</MetricSection>
      <MetricSection title="Most-liked listings" empty="No recent listing likes yet.">{likes.map((row) => { const listing = listingById.get(row.listingId); return listing && <li key={listing.id} className="flex justify-between gap-3 py-2 text-sm"><Link href={`/listing/${listing.slug}`} className="truncate font-medium text-brand">{listing.title}</Link><span className="text-slate-500">{row._count._all} likes</span></li>; })}</MetricSection>
      <MetricSection title="Most-saved listings" empty="No recent listing saves yet.">{saves.flatMap((row) => { const listing = row.listingId ? listingById.get(row.listingId) : undefined; return listing ? [<li key={listing.id} className="flex justify-between gap-3 py-2 text-sm"><Link href={`/listing/${listing.slug}`} className="truncate font-medium text-brand">{listing.title}</Link><span className="text-slate-500">{row._count._all} saves</span></li>] : []; })}</MetricSection>
      <MetricSection title="Trending locations" empty="Location trends will appear as listings receive activity.">{topLocations.map(([location, count]) => <li key={location} className="flex justify-between gap-3 py-2 text-sm"><span className="truncate">{location}</span><span className="text-slate-500">{count} signals</span></li>)}</MetricSection>
    </div>
  </main>;
}

function MetricSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return <section className="border-t border-border pt-4"><h2 className="text-base font-semibold">{title}</h2>{Children.count(children) ? <ul className="mt-2 divide-y divide-border">{children}</ul> : <p className="mt-3 text-sm text-slate-500">{empty}</p>}</section>;
}