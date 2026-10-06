import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/app-url";
import { formatZAR } from "@/lib/utils";
import { getTrust } from "@/lib/trust";
import { publicPath, publicUrl } from "@/lib/share";
import { cardMetadata, getShareCard, unavailableMetadata } from "@/lib/share-meta";
import { ListingActions } from "@/components/listings/listing-actions";
import { ListingEngagementTracker } from "@/components/listings/listing-engagement-tracker";
import { FollowButton } from "@/components/follow/follow-button";
import { VerifiedBadge } from "@/components/profile/verified-badge";
import { ShareButton } from "@/components/share/share-button";
import { SharedLinkTracker } from "@/components/share/shared-link-tracker";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const card = await getShareCard("LISTING", slug);
  return card ? cardMetadata(card, slug) : unavailableMetadata;
}

const cardClass = "overflow-hidden rounded-lg border border-border bg-white hover:shadow-md";

export default async function ListingPage({ params }: Props) {
  const { slug } = await params;
  const listing = await prisma.listing.findUnique({
    where: { slug },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      category: true,
      seller: { select: { id: true, username: true, displayName: true, createdAt: true, identityVerification: true, profileVerification: true } },
    },
  });
  if (!listing || !["ACTIVE", "SOLD", "REMOVED"].includes(listing.status)) notFound();
  const available = listing.status === "ACTIVE";

  // Similar listings keep visitors browsing when the item is gone, and fill out an active page.
  const related = await prisma.listing.findMany({
    where: { status: "ACTIVE", categoryId: listing.categoryId, id: { not: listing.id } },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { id: true, slug: true, title: true, priceCents: true, location: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
  });
  const relatedGrid = related.length > 0 && (
    <section className="mt-12">
      <h2 className="text-lg font-semibold">{available ? "Related listings" : "Similar listings available now"}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {related.map((item) => (
          <Link key={item.id} href={publicPath("LISTING", item.slug)} className={cardClass}>
            <div className="relative aspect-square bg-slate-100">{item.images[0] ? <Image src={item.images[0].url} alt={item.title} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No image</div>}</div>
            <div className="p-3"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-1 text-sm font-semibold text-brand">{formatZAR(item.priceCents)}</p><p className="mt-1 truncate text-xs text-slate-500">{item.location}</p></div>
          </Link>
        ))}
      </div>
    </section>
  );

  if (!available) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="rounded-lg border border-border bg-white p-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">This listing is no longer available.</h1>
          <p className="mt-2 text-sm text-slate-500">{listing.status === "SOLD" ? "It has been sold." : "The seller has removed it."} You can browse similar items below.</p>
          <Link href="/marketplace" className="mt-5 inline-block rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white">Browse marketplace</Link>
        </div>
        {relatedGrid}
      </div>
    );
  }

  const url = publicUrl(appUrl(), "LISTING", listing.slug);
  const trust = await getTrust(listing.seller.id);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description.slice(0, 300),
    image: listing.images.map((image) => (image.url.startsWith("http") ? image.url : `${appUrl()}${image.url}`)),
    url,
    itemCondition: listing.condition === "NEW" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
    offers: { "@type": "Offer", price: (listing.priceCents / 100).toFixed(2), priceCurrency: listing.currency, availability: "https://schema.org/InStock", url },
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ListingEngagementTracker listingId={listing.id} />
      <SharedLinkTracker target="LISTING" targetId={listing.id} />
      <Link href="/marketplace" className="text-sm font-medium text-brand">← Back to marketplace</Link>
      <div className="mt-5 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8">
        <div>
          {listing.images.length ? (
            <div className="grid grid-cols-2 gap-3">
              {listing.images.map((image, index) => <Image key={image.id} src={image.url} alt={`${listing.title} photo ${index + 1}`} width={1200} height={1200} sizes="(max-width: 640px) 100vw, 50vw" className={`aspect-square w-full rounded-lg bg-slate-100 object-cover ${index === 0 ? "col-span-2 sm:aspect-[4/3]" : ""}`} />)}
            </div>
          ) : <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">No images</div>}
        </div>
        <div>
          <p className="text-sm text-brand">{listing.category.name}</p>
          <div className="mt-2 flex items-start justify-between gap-3"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{listing.title}</h1><ShareButton target="LISTING" targetId={listing.id} url={url} title={listing.title} className="shrink-0 !px-3 !py-2" /></div>
          <p className="mt-3 text-2xl font-semibold text-brand">{formatZAR(listing.priceCents)}</p>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{listing.description}</p>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5 text-sm"><div><dt className="text-slate-500">Condition</dt><dd className="mt-1 font-medium">{listing.condition.replaceAll("_", " ")}</dd></div><div><dt className="text-slate-500">Location</dt><dd className="mt-1 font-medium">{listing.location}</dd></div></dl>
          <div className="mt-6 rounded-lg border border-border p-4">
            <p className="text-xs text-slate-500">Seller</p>
            <p className="mt-1 font-semibold"><Link href={`/@${listing.seller.username}`} className="hover:text-brand">{listing.seller.displayName}</Link> <VerifiedBadge verified={listing.seller.profileVerification === "VERIFIED"} /></p>
            <p className="text-sm text-slate-500">@{listing.seller.username}</p>
            {listing.seller.identityVerification === "VERIFIED" && <p className="mt-2 text-xs font-medium text-emerald-700">Verified identity</p>}
            {trust && <p className="mt-2 text-xs font-medium text-brand">Vera Trust {trust.score}/100 · {trust.tier}</p>}
            <FollowButton kind="seller" id={listing.seller.id} label="Follow seller" />
          </div>
          <ListingActions listingId={listing.id} title={listing.title} />
        </div>
      </div>
      {relatedGrid}
    </div>
  );
}