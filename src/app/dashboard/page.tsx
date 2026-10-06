import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { getTrust } from "@/lib/trust";
import { evaluateAchievements, listAchievements } from "@/lib/achievements";
import { activePro, proFeatures } from "@/lib/pro";
import { expireStaleOffers } from "@/lib/offers";
import { appUrl } from "@/lib/app-url";
import { publicUrl } from "@/lib/share";
import { ShareButton } from "@/components/share/share-button";
import { CopyLinkButton } from "@/components/share/copy-link-button";

export const dynamic = "force-dynamic";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/dashboard");
  const userId = session.user.id;
  await expireStaleOffers();
  await evaluateAchievements(userId).catch(() => null);
  const monthAgo = daysAgo(30);
  const [trust, achievements, pro, features, listings, openOffers, savedSearches] = await Promise.all([
    getTrust(userId),
    listAchievements(userId),
    activePro(userId),
    proFeatures(userId),
    prisma.listing.findMany({ where: { sellerId: userId, status: { in: ["ACTIVE", "PENDING_REVIEW", "SOLD"] } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, slug: true, title: true, status: true, priceCents: true, _count: { select: { favorites: true, conversations: true, offers: true } } } }),
    prisma.offer.findMany({ where: { sellerId: userId, status: "PENDING", madeById: { not: userId } }, orderBy: { createdAt: "desc" }, take: 10, include: { listing: { select: { title: true } } } }),
    prisma.savedSearch.count({ where: { userId } }),
  ]);
  const views = await prisma.listingEngagement.groupBy({ by: ["listingId"], where: { type: "VIEW", createdAt: { gte: monthAgo }, listingId: { in: listings.map((l) => l.id) } }, _count: { _all: true } });
  const viewsById = new Map(views.map((v) => [v.listingId, v._count._all]));
  const totalViews = [...viewsById.values()].reduce((a, b) => a + b, 0);
  const card = "rounded-lg border border-border bg-white p-5";
  const [shop, shareGroups] = await Promise.all([
    prisma.shop.findFirst({ where: { ownerId: userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, slug: true } }),
    prisma.shareEvent.groupBy({ by: ["targetType", "kind"], where: { ownerId: userId }, _count: { _all: true } }),
  ]);
  const shareCount = (kind: string, type?: string) => shareGroups.filter((g) => g.kind === kind && (!type || g.targetType === type)).reduce((n, g) => n + g._count._all, 0);
  const shareStats = [
    { label: "Shop link views", value: shareCount("LINK_VIEW", "SHOP") },
    { label: "Listing link views", value: shareCount("LINK_VIEW", "LISTING") },
    { label: "Shares", value: shareCount("SHARE") },
    { label: "Chats from shared links", value: shareCount("CHAT") },
  ];
  const shopUrl = shop ? publicUrl(appUrl(), "SHOP", shop.slug) : null;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium text-brand">Seller dashboard</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Your marketplace at a glance</h1></div><div className="flex gap-2 text-sm"><Link href="/sell" className="rounded-md bg-brand px-4 py-2 font-semibold text-white">New listing</Link><Link href="/profile/boosts" className="rounded-md border border-border px-4 py-2 font-medium">Boost</Link><Link href="/pro" className="rounded-md border border-border px-4 py-2 font-medium">{pro ? "Vera Pro ✓" : "Vera Pro"}</Link></div></div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className={card}><p className="text-xs uppercase tracking-wide text-slate-500">Vera Trust</p>{trust && <><p className="mt-2 text-4xl font-semibold">{trust.score}<span className="text-lg text-slate-400">/100</span></p><p className="text-sm font-medium text-brand">{trust.tier}</p><ul className="mt-3 space-y-1 text-xs text-slate-600">{trust.signals.map((s) => <li key={s.label} className="flex justify-between"><span>{s.label}</span><span className={s.points < 0 ? "text-red-700" : "text-emerald-700"}>{s.points > 0 ? "+" : ""}{s.points}</span></li>)}</ul><p className="mt-3 text-xs text-slate-500">Verify your profile and complete sales to raise your score.</p></>}</div>
        <div className={`${card} md:col-span-2`}><p className="text-xs uppercase tracking-wide text-slate-500">Last 30 days</p><div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">{[["Listing views", totalViews], ["Active listings", listings.filter((l) => l.status === "ACTIVE").length], ["Completed sales", trust?.stats.completedSales ?? 0], ["Saved searches", savedSearches]].map(([label, value]) => <div key={String(label)}><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-slate-500">{label}</p></div>)}</div></div>
      </div>
      <section className={`${card} mt-4`}><h2 className="font-semibold">Offers waiting for you</h2>{openOffers.length === 0 ? <p className="mt-2 text-sm text-slate-500">No pending offers.</p> : <ul className="mt-3 divide-y divide-border text-sm">{openOffers.map((o) => <li key={o.id} className="flex items-center justify-between py-2"><span className="truncate">{formatZAR(o.amountCents)} on {o.listing.title}</span><Link href={`/messages/${o.conversationId}`} className="text-brand">Respond</Link></li>)}</ul>}</section>
      <section className={`${card} mt-4`}><h2 className="font-semibold">Listing performance</h2>{!features?.advancedAnalytics ? <p className="mt-2 text-sm text-slate-500">Per-listing analytics are part of <Link href="/pro" className="text-brand">Vera Pro</Link>.</p> : listings.length === 0 ? <p className="mt-2 text-sm text-slate-500">No listings yet.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="py-1">Listing</th><th>Views (30d)</th><th>Saves</th><th>Chats</th><th>Offers</th></tr></thead><tbody>{listings.map((l) => <tr key={l.id} className="border-t border-border"><td className="py-2"><Link href={`/listing/${l.slug}`} className="text-brand">{l.title}</Link></td><td>{viewsById.get(l.id) ?? 0}</td><td>{l._count.favorites}</td><td>{l._count.conversations}</td><td>{l._count.offers}</td></tr>)}</tbody></table></div>}</section>
      <section className={`${card} mt-4`}>
        <h2 className="font-semibold">Share &amp; Promote</h2>
        <p className="mt-1 text-sm text-slate-600">Anyone can open these links in a browser, with or without an account or the app.</p>
        {shop && shopUrl ? (
          <div className="mt-4 rounded-lg bg-brand-light/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">My Virtual Shop link</p>
            <p className="mt-1 break-all text-sm font-medium text-brand">{shopUrl}</p>
            <div className="mt-3 flex flex-wrap gap-2"><CopyLinkButton url={shopUrl} /><ShareButton target="SHOP" targetId={shop.id} url={shopUrl} title={shop.name} label="Share Shop" variant="primary" /></div>
          </div>
        ) : <p className="mt-4 text-sm text-slate-500">Your shop link appears here once your Virtual Shop is active.</p>}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{shareStats.map((s) => <div key={s.label} className="rounded-lg border border-border p-3"><p className="text-xl font-semibold">{s.value}</p><p className="text-xs text-slate-500">{s.label}</p></div>)}</div>
        <h3 className="mt-5 text-sm font-semibold">My Listings</h3>
        {listings.filter((l) => l.status === "ACTIVE").length === 0 ? <p className="mt-2 text-sm text-slate-500">No active listings to share yet.</p> : (
          <ul className="mt-2 divide-y divide-border">{listings.filter((l) => l.status === "ACTIVE").map((l) => { const link = publicUrl(appUrl(), "LISTING", l.slug); return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><Link href={`/listing/${l.slug}`} className="min-w-0 flex-1 truncate text-sm hover:text-brand">{l.title}</Link><div className="flex gap-2"><CopyLinkButton url={link} /><ShareButton target="LISTING" targetId={l.id} url={link} title={l.title} variant="subtle" /></div></li>
          ); })}</ul>
        )}
      </section>      <section className={`${card} mt-4`}><h2 className="font-semibold">Achievements</h2><ul className="mt-3 grid gap-3 sm:grid-cols-2">{achievements.map((a) => <li key={a.id} className={`rounded-md border p-3 text-sm ${a.awardedAt ? "border-emerald-200 bg-emerald-50" : "border-border opacity-70"}`}><p className="font-medium">{a.awardedAt ? "🏆 " : "🔒 "}{a.name}</p><p className="text-xs text-slate-600">{a.description}</p>{a.awardedAt && <p className="mt-1 text-[11px] text-emerald-700">Earned {a.awardedAt.toLocaleDateString("en-ZA")}</p>}</li>)}</ul></section>
      <div className="mt-4 flex flex-wrap gap-4 text-sm"><Link href="/profile/searches" className="text-brand">Saved searches</Link><Link href="/profile/saved" className="text-brand">Wishlist</Link><Link href="/messages" className="text-brand">Messages</Link></div>
    </div>
  );
}