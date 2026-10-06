import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { RemoveFavoriteButton } from "@/components/favorites/remove-favorite-button";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SavedListingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/profile/saved");

  const favorites = await prisma.favorite.findMany({
    where: { userId: session.user.id, listingId: { not: null }, listing: { status: { in: ["ACTIVE", "SOLD"] } } },
    orderBy: { createdAt: "desc" },
    include: { listing: { include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, seller: { select: { displayName: true, username: true } } } } },
  });
  const savedListings = favorites.flatMap((favorite) => favorite.listing ? [{ favorite, listing: favorite.listing }] : []);

  return <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
    <p className="text-sm font-medium text-brand">Your account</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Saved listings</h1><p className="mt-2 text-sm text-slate-500">Listings you have saved for later.</p>
    {savedListings.length === 0 ? <div className="mt-8 border-y border-border py-14 text-center"><p className="font-medium">No saved listings yet</p><Link href="/marketplace" className="mt-4 inline-block text-sm font-semibold text-brand">Browse the marketplace</Link></div> : <div className="mt-8 divide-y divide-border border-y border-border">{savedListings.map(({ favorite, listing }) => <article key={favorite.id} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center">
      <Link href={`/listing/${listing.slug}`} className="flex min-w-0 flex-1 items-center gap-4">{listing.images[0] ? <Image src={listing.images[0].url} alt="" width={80} height={80} sizes="80px" className="h-20 w-20 shrink-0 rounded-md object-cover" /> : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-brand-light text-sm font-semibold text-brand">VM</span>}<span className="min-w-0"><span className="block truncate font-semibold">{listing.title}</span><span className="mt-1 block text-sm font-semibold text-brand">{formatZAR(listing.priceCents)}</span><span className="mt-1 block truncate text-xs text-slate-500">{listing.location} · {listing.seller.displayName} (@{listing.seller.username})</span><span className={`mt-1 block text-xs font-semibold ${listing.status === "SOLD" ? "text-red-700" : "text-emerald-700"}`}>{listing.status === "SOLD" ? "Sold" : "Available"}</span></span></Link>
      <div className="flex items-center gap-3">{listing.status === "ACTIVE" && <Link href={`/listing/${listing.slug}#message-box`} className="rounded-md bg-brand px-3 py-2 text-center text-xs font-semibold text-white">Contact seller</Link>}<RemoveFavoriteButton favoriteId={favorite.id} /></div>
    </article>)}</div>}
  </main>;
}