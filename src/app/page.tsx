import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { activeShopFilter } from "@/lib/shops";
import { publicPropertyWhere, publicServiceWhere } from "@/lib/content-visibility";
import { Greeting } from "@/components/home/greeting";
import { FavoriteToggle } from "@/components/favorites/favorite-toggle";
import { cdnImage } from "@/lib/image-url";
import { getListings } from "@/lib/listings";
import { formatZAR } from "@/lib/utils";

export const dynamic = "force-dynamic";

const firstImage = { take: 1, orderBy: { sortOrder: "asc" as const }, select: { url: true } };

async function getHomeCovers() {
  const [shop, service, property] = await Promise.all([
    prisma.shop.findFirst({ where: { ...activeShopFilter(), images: { some: {} } }, orderBy: { createdAt: "desc" }, select: { images: firstImage } }),
    prisma.serviceListing.findFirst({ where: { ...publicServiceWhere(), images: { some: {} } }, orderBy: { createdAt: "desc" }, select: { images: firstImage } }),
    prisma.propertyListing.findFirst({ where: { ...publicPropertyWhere(), images: { some: {} } }, orderBy: { createdAt: "desc" }, select: { images: firstImage } }),
  ]);

  return {
    // Marketplace no longer borrows a product listing image as its cover;
    // a dedicated cover will be configured later. Until then the card keeps
    // its neutral gradient background.
    marketplace: undefined,
    shops: shop?.images[0]?.url,
    services: service?.images[0]?.url,
    property: property?.images[0]?.url,
  };
}
export default async function Home() {
  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-dark via-brand to-sky-700">
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent" aria-hidden="true" />
        <div className="relative mx-auto max-w-5xl px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10">
          <Greeting />
     <div className="mt-5 flex items-center gap-2 sm:gap-3">
  <form action="/marketplace" role="search" className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white p-1.5 shadow-lg">
    <svg viewBox="0 0 24 24" className="ml-1.5 hidden h-5 w-5 shrink-0 fill-none stroke-slate-400 sm:block" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
    <input
      name="q"
      type="search"
      placeholder="Search Vera Market..."
      aria-label="Search on Vera Market"
      className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-foreground outline-none placeholder:text-slate-400"
    />
    <button type="submit" aria-label="Search" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition hover:bg-brand-dark">
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    </button>
  </form>
  <Link
    href="/sell"
    className="flex h-[52px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand px-2 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-dark sm:px-5"
  >
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
    Sell Something
  </Link>
</div>

        </div>
      </section>

      <section className="mx-auto -mt-4 max-w-5xl px-4 sm:px-6">
        <Suspense fallback={<CategoryCardGrid />}>
          <HomepageCategories />
        </Suspense>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-10 pt-8 sm:px-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Trending for You</h2>
          <Link href="/trending" className="text-sm font-semibold text-brand">
            View All <span aria-hidden="true">→</span>
          </Link>
        </div>
        <Suspense fallback={<HomepageListingsSkeleton />}>
          <HomepageListings />
        </Suspense>
      </section>

    </div>
  );
}

async function HomepageCategories() {
  const covers = await getHomeCovers();
  return (
    <CategoryCardGrid
      covers={covers}
    />
  );
}

function CategoryCardGrid({
  covers,
}: {
  covers?: Awaited<ReturnType<typeof getHomeCovers>>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <CategoryCard
        title="Marketplace"
        subtitle="Buy and sell products"
        href="/marketplace"
        image={covers?.marketplace}
      />
      <CategoryCard
        title="Virtual Shop"
        subtitle="Real businesses, real products"
        href="/shops"
        image={covers?.shops}
      />
      <CategoryCard
        title="Services"
        subtitle="Find trusted people and businesses"
        href="/services"
        image={covers?.services}
      />
      <CategoryCard
        title="Real Estate"
        subtitle="Buy, rent and discover property"
        href="/real-estate"
        image={covers?.property}
      />
    </div>
  );
}

async function HomepageListings() {
  const { listings } = await getListings({ page: 1 });
  const items = listings.slice(0, 8);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <p className="font-medium">No listings yet</p>
        <p className="mt-1 text-sm text-slate-500">Check back soon for new marketplace listings.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((listing, index) => (
        <article key={listing.id} className="overflow-hidden rounded-lg border border-border bg-white hover:shadow-md">
          <Link href={`/listing/${listing.slug}`} aria-label={`View listing ${listing.title}`} className="block">
            <div className="relative aspect-square bg-slate-100">
              <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1">
                {listing.boosted && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-950">Boosted</span>}
                {listing.store && <span className="truncate rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">Available in Virtual Store</span>}
              </div>
              {listing.images[0] ? (
                <Image
                  src={cdnImage(listing.images[0].url, 640)}
                  alt={listing.title}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  preload={index === 0}
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">No image</div>
              )}
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-medium">{listing.title}</p>
              <p className="mt-1 text-sm font-semibold text-brand">{formatZAR(listing.priceCents)}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{listing.areaName || listing.location} · {listing.category.name}</p>
            </div>
          </Link>
          <div className="px-3 pb-3">
            <FavoriteToggle targetType="LISTING" targetId={listing.id} />
          </div>
        </article>
      ))}
    </div>
  );
}

function HomepageListingsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Loading listings">
      {[...Array(8)].map((_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-border bg-white animate-pulse">
          <div className="aspect-square bg-slate-200" />
          <div className="space-y-2 p-3">
            <div className="h-4 w-3/4 rounded bg-slate-200" />
            <div className="h-4 w-1/2 rounded bg-slate-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryCard({ title, subtitle, href, image, preload }: { title: string; subtitle: string; href: string; image?: string; preload?: boolean }) {
  return (
    <Link href={href} className="group relative flex aspect-[4/3] items-end overflow-hidden rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 shadow-md ring-1 ring-black/5">
      {image && (
        <Image
          src={cdnImage(image, 800)}
          alt=""
          fill
          sizes="(max-width: 640px) 50vw, 25vw"
          preload={preload}
          className="object-cover transition duration-300 group-hover:scale-105"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" aria-hidden="true" />
      <div className="relative p-3">
        <h3 className="text-base font-semibold leading-tight text-white">{title}</h3>
        <p className="mt-0.5 text-xs leading-snug text-white/85">{subtitle}</p>
      </div>
    </Link>
  );
}
