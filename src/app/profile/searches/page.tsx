import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { SavedSearchList } from "@/components/searches/saved-search-list";

export const dynamic = "force-dynamic";

export default async function SavedSearchesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/profile/searches");
  const searches = await prisma.savedSearch.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" } });
  const rows = searches.map((s) => {
    const parts = [s.query && `"${s.query}"`, s.categorySlug && `category: ${s.categorySlug}`, s.condition, s.location, s.minPriceCents !== null && `from ${formatZAR(s.minPriceCents)}`, s.maxPriceCents !== null && `up to ${formatZAR(s.maxPriceCents)}`].filter(Boolean);
    const params = new URLSearchParams();
    if (s.query) params.set("q", s.query);
    if (s.categorySlug) params.set("category", s.categorySlug);
    return { id: s.id, name: s.name, summary: parts.join(" · "), href: `/marketplace?${params.toString()}`, alertsEnabled: s.alertsEnabled };
  });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-sm font-medium text-brand">Smart alerts</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Saved searches</h1>
      <p className="mt-2 text-sm text-slate-500">Get notified when a new listing matches. Save a search from the marketplace.</p>
      <div className="mt-8">{rows.length ? <SavedSearchList searches={rows} /> : <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center"><p className="font-medium">No saved searches yet</p><Link href="/marketplace" className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Browse marketplace</Link></div>}</div>
    </div>
  );
}