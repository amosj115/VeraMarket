import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { RemoveFavoriteButton } from "@/components/favorites/remove-favorite-button";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/profile/favorites");
  const favorites = await prisma.favorite.findMany({
    where: {
      userId: session.user.id,
      OR: [
        { listing: { status: "ACTIVE" } },
        { shop: { status: "ACTIVE" } },
        { service: { status: "ACTIVE" } },
        { property: { status: "ACTIVE" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      listing: { include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, category: { select: { name: true } } } },
      shop: { select: { name: true, slug: true, address: true } },
      service: { select: { title: true, slug: true, location: true, priceCents: true, category: { select: { name: true } } } },
      property: { select: { title: true, slug: true, location: true, priceCents: true, listingType: true, propertyType: true } },
    },
  });
  const groups = [
    { title: "Products", items: favorites.flatMap((favorite) => favorite.listing ? [{ favorite, title: favorite.listing.title, href: `/listing/${favorite.listing.slug}`, detail: `${formatZAR(favorite.listing.priceCents)} · ${favorite.listing.location}`, image: favorite.listing.images[0]?.url }] : []) },
    { title: "Shops", items: favorites.flatMap((favorite) => favorite.shop ? [{ favorite, title: favorite.shop.name, href: `/shops/${favorite.shop.slug}`, detail: favorite.shop.address, image: undefined }] : []) },
    { title: "Services", items: favorites.flatMap((favorite) => favorite.service ? [{ favorite, title: favorite.service.title, href: `/services/${favorite.service.slug}`, detail: `${favorite.service.priceCents == null ? "Request a quote" : formatZAR(favorite.service.priceCents)} · ${favorite.service.location}`, image: undefined }] : []) },
    { title: "Properties", items: favorites.flatMap((favorite) => favorite.property ? [{ favorite, title: favorite.property.title, href: `/real-estate/${favorite.property.slug}`, detail: `${favorite.property.listingType === "FOR_SALE" ? "For sale" : "For rent"} · ${formatZAR(favorite.property.priceCents)} · ${favorite.property.location}`, image: undefined }] : []) },
  ];
  return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8"><p className="text-sm font-medium text-brand">Your account</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Favorites</h1><p className="mt-2 text-sm text-slate-500">Items you have saved across Vera Market.</p>{favorites.length === 0 ? <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-16 text-center"><p className="font-medium">No favorites yet</p><p className="mt-1 text-sm text-slate-500">Save products, shops, services, or properties to find them here.</p><Link href="/marketplace" className="mt-5 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Browse marketplace</Link></div> : <div className="mt-8 space-y-8">{groups.filter((group) => group.items.length > 0).map((group) => <section key={group.title}><h2 className="text-lg font-semibold">{group.title}</h2><div className="mt-3 divide-y divide-border rounded-lg border border-border bg-white">{group.items.map(({ favorite, title, href, detail, image }) => <div key={favorite.id} className="flex items-center gap-4 p-4"><Link href={href} className="flex min-w-0 flex-1 items-center gap-4">  {image ? <Image src={image} alt="" width={64} height={64} sizes="64px" className="h-16 w-16 shrink-0 rounded-md object-cover" /> : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-brand-light text-sm font-semibold text-brand">{title.slice(0, 1).toUpperCase()}</span>}<span className="min-w-0"><span className="block truncate text-sm font-semibold">{title}</span><span className="mt-1 block truncate text-xs text-slate-500">{detail}</span></span></Link><RemoveFavoriteButton favoriteId={favorite.id} /></div>)}</div></section>)}</div>}</div>;
}
