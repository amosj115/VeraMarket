import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTrendingPage } from "@/lib/trending";
import { formatZAR } from "@/lib/utils";
import { activeShopFilter } from "@/lib/shops";
import { Greeting } from "@/components/home/greeting";
import { HeartButton } from "@/components/home/heart-button";

export const dynamic = "force-dynamic";

const firstImage = { take: 1, orderBy: { sortOrder: "asc" as const }, select: { url: true } };

async function getHomeCovers() {
  const [listing, shop, service, property] = await Promise.all([
    prisma.listing.findFirst({ where: { status: "ACTIVE", images: { some: {} } }, orderBy: { createdAt: "desc" }, select: { images: firstImage } }),
    prisma.shop.findFirst({ where: { ...activeShopFilter(), images: { some: {} } }, orderBy: { createdAt: "desc" }, select: { images: firstImage } }),
    prisma.serviceListing.findFirst({ where: { status: "ACTIVE", images: { some: {} } }, orderBy: { createdAt: "desc" }, select: { images: firstImage } }),
    prisma.propertyListing.findFirst({ where: { status: "ACTIVE", images: { some: {} } }, orderBy: { createdAt: "desc" }, select: { images: firstImage } }),
  ]);

  return {
    marketplace: listing?.images[0]?.url,
    shops: shop?.images[0]?.url,
    services: service?.images[0]?.url,
    property: property?.images[0]?.url,
  };
}

export default async function Home() {
  const session = await auth();

  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-dark via-brand to-sky-700">
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent" aria-hidden="true" />
        <div className="relative mx-auto max-w-5xl px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10">
          <Greeting />
          <form action="/marketplace" role="search" className="mt-5 flex items-center gap-2 rounded-xl bg-white p-1.5 shadow-lg">
            <svg viewBox="0 0 24 24" className="ml-2 h-5 w-5 shrink-0 fill-none stroke-slate-400" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              name="q"
              type="search"
              placeholder="Search on Vera Market..."
              aria-label="Search on Vera Market"
              className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-foreground outline-none placeholder:text-slate-400"
            />
            <button type="submit" aria-label="Search" className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white transition hover:bg-brand-dark">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          </form>
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

        <Suspense fallback={<TrendingSkeleton />}>
          <TrendingSection userId={session?.user?.id} />
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

function CategoryCard({ title, subtitle, href, image }: { title: string; subtitle: string; href: string; image?: string }) {
  return (
    <Link href={href} className="group relative flex aspect-[4/3] items-end overflow-hidden rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 shadow-md ring-1 ring-black/5">
      {image && (
        <Image
          src={image}
          alt=""
          fill
          sizes="(max-width: 640px) 50vw, 25vw"
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

async function TrendingSection({ userId }: { userId?: string }) {
  const trending = await getTrendingPage(userId, 0);
  const items = trending.items.slice(0, 8);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-white px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">No listings yet</p>
        <p className="mt-1 text-sm text-slate-500">
          Be the first person to list something on Vera Market.
        </p>
        <Link
          href="/sell"
          className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          Create a listing
        </Link>
      </div>
    );
  }

  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/listing/${item.slug}`}
          className="group relative w-40 shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-white shadow-sm transition hover:shadow-md sm:w-48"
        >
          <div className="relative aspect-square bg-slate-100">
            {item.images[0] ? (
              <Image
                src={item.images[0].url}
                alt={item.title}
                fill
                sizes="(max-width: 640px) 160px, 192px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                No image
              </div>
            )}
            <HeartButton listingId={item.id} initialSaved={item.saved} />
          </div>
          <div className="p-2.5">
            <p className="truncate text-sm font-medium text-foreground">
              {item.title}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-brand">
              {formatZAR(item.priceCents)}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {item.location}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function TrendingSkeleton() {
  return (
    <div
      aria-label="Loading trending listings"
      className="flex gap-3 overflow-hidden"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="w-40 shrink-0 overflow-hidden rounded-xl border border-border sm:w-48"
        >
          <div className="aspect-square animate-pulse bg-slate-100" />
          <div className="space-y-2 p-3">
            <div className="h-3 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
