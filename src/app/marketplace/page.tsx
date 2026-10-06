import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { activeListingBoosts } from "@/lib/boosts";
import { SaveSearchButton } from "@/components/searches/save-search-button";
import { SearchActivityRecorder } from "@/components/trending/search-activity-recorder";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MarketplacePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const category = typeof params.category === "string" ? params.category : "";

  const where = {
    status: "ACTIVE" as const,
    ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" as const } }, { description: { contains: query, mode: "insensitive" as const } }] } : {}),
    ...(category ? { category: { slug: category } } : {}),
  };
  const select = {
    id: true,
    slug: true,
    title: true,
    priceCents: true,
    location: true,
    createdAt: true,
    images: {
      take: 1,
      orderBy: { sortOrder: "asc" as const },
      select: { url: true },
    },
    category: { select: { name: true, slug: true } },
  };
  const boosts = await activeListingBoosts();
  const [categories, recent, boostedMatches] = await Promise.all([
    prisma.category.findMany({ where: { domain: "MARKETPLACE", isEnabled: true }, orderBy: { sortOrder: "asc" } }),
    prisma.listing.findMany({ where, orderBy: { createdAt: "desc" }, take: 48, select }),
    boosts.size ? prisma.listing.findMany({ where: { ...where, id: { in: [...boosts.keys()] } }, take: 12, select }) : Promise.resolve([]),
  ]);
  // Active paid boosts are ranked first, highest package priority first, then newest.
  const merged = new Map([...boostedMatches, ...recent].map((listing) => [listing.id, listing]));
  const listings = [...merged.values()].sort((a, b) => (boosts.get(b.id) ?? 0) - (boosts.get(a.id) ?? 0) || b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 48);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-sm font-medium text-brand">Marketplace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Find something real</h1><p className="mt-2 text-sm text-slate-500">Browse products listed by real people on Vera Market.</p></div>
        <Link href="/sell" className="rounded-md bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-dark">Sell something</Link>
      </div>
      <form className="mt-8 flex flex-col gap-3 sm:flex-row" method="get">
        <input name="q" defaultValue={query} placeholder="Search listings" className="flex-1 rounded-md border border-border px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand" />
        <select name="category" defaultValue={category} className="rounded-md border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-brand">
          <option value="">All categories</option>{categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
        </select>
        <button className="rounded-md border border-brand px-5 py-2.5 text-sm font-semibold text-brand hover:bg-brand-light">Search</button>
      </form>
      <SearchActivityRecorder query={query} categorySlug={category} />
      {(query || category) && <SaveSearchButton query={query} categorySlug={category} label={query || categories.find((item) => item.slug === category)?.name || "Saved search"} />}
      <div className="mt-8">
        {listings.length === 0 ? <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center"><p className="font-medium">{query || category ? "No listings match your search" : "No listings yet"}</p><p className="mt-1 text-sm text-slate-500">{query || category ? "Try another search or browse all categories." : "Be the first person to list something on Vera Market."}</p>{!query && !category && <Link href="/sell" className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Create a listing</Link>}</div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{listings.map((listing) => <Link key={listing.id} href={`/listing/${listing.slug}`} className="overflow-hidden rounded-lg border border-border bg-white hover:shadow-md"><div className="relative aspect-square bg-slate-100">{boosts.has(listing.id) && <span className="absolute left-2 top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-950">Boosted</span>}{listing.images[0] ? <Image src={listing.images[0].url} alt={listing.title} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No image</div>}</div><div className="p-3"><p className="truncate text-sm font-medium">{listing.title}</p><p className="mt-1 text-sm font-semibold text-brand">{formatZAR(listing.priceCents)}</p><p className="mt-1 truncate text-xs text-slate-500">{listing.location} · {listing.category.name}</p></div></Link>)}</div>}
      </div>
    </div>
  );
}
