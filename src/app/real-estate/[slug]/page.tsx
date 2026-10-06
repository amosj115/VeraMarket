import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { FavoriteToggle } from "@/components/favorites/favorite-toggle";
import { FollowButton } from "@/components/follow/follow-button";
import { VerifiedBadge } from "@/components/profile/verified-badge";
import { appUrl } from "@/lib/app-url";
import { publicUrl } from "@/lib/share";
import { cardMetadata, getShareCard, unavailableMetadata } from "@/lib/share-meta";
import { ShareButton } from "@/components/share/share-button";
import { SharedLinkTracker } from "@/components/share/shared-link-tracker";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const card = await getShareCard("PROPERTY", slug);
  return card ? cardMetadata(card, slug) : unavailableMetadata;
}

export default async function PropertyDetailPage({ params }: Props) {
  const { slug } = await params;
  const property = await prisma.propertyListing.findUnique({
    where: { slug },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      owner: {
        select: {
          username: true,
          displayName: true,
          identityVerification: true,
          profileVerification: true,
          createdAt: true,
        },
      },
    },
  });
  if (!property || property.status !== "ACTIVE") notFound();
  return <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8"><Link href="/real-estate" className="text-sm font-medium text-brand">← Back to real estate</Link><div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]"><div className="grid grid-cols-2 gap-3">{property.images.length ? property.images.map((image) => <img key={image.id} src={image.url} alt={property.title} className="aspect-square w-full rounded-lg bg-slate-100 object-cover" />) : <div className="col-span-2 flex aspect-video items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">No images</div>}</div><div><p className="text-xs font-semibold uppercase text-brand">{property.listingType === "FOR_SALE" ? "For sale" : "For rent"} · {property.propertyType.toLowerCase().replaceAll("_", " ")}</p><div className="mt-2 flex items-start justify-between gap-3"><h1 className="text-3xl font-semibold tracking-tight">{property.title}</h1><ShareButton target="PROPERTY" targetId={property.id} url={publicUrl(appUrl(), "PROPERTY", property.slug)} title={property.title} variant="subtle" className="shrink-0" /></div><SharedLinkTracker target="PROPERTY" targetId={property.id} /><p className="mt-3 text-2xl font-semibold text-brand">{formatZAR(property.priceCents)}{property.listingType === "FOR_RENT" ? <span className="text-sm font-normal text-slate-500"> / month</span> : null}</p><p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-600">{property.description}</p><dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5 text-sm">{property.bedrooms != null && <Info label="Bedrooms" value={String(property.bedrooms)} />}{property.bathrooms != null && <Info label="Bathrooms" value={String(property.bathrooms)} />}{property.parkingSpaces != null && <Info label="Parking" value={String(property.parkingSpaces)} />}{property.floorAreaSqm != null && <Info label="Floor area" value={`${property.floorAreaSqm} m²`} />}{property.landSizeSqm != null && <Info label="Land size" value={`${property.landSizeSqm} m²`} />}<Info label="Location" value={property.location} /></dl><div className="mt-6 rounded-lg border border-border p-4"><p className="text-xs text-slate-500">Listed by</p><p className="mt-1 font-semibold"><Link href={`/u/${property.owner.username}`} className="hover:text-brand">{property.owner.displayName}</Link> <VerifiedBadge verified={property.owner.profileVerification === "VERIFIED"} /></p><p className="text-sm text-slate-500">@{property.owner.username}</p>{property.owner.identityVerification === "VERIFIED" && <p className="mt-2 text-xs font-medium text-emerald-700">Verified identity</p>}<FollowButton kind="seller" id={property.ownerId} /></div><FavoriteToggle targetType="PROPERTY" targetId={property.id} /></div></div></div>;
}
function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>; }
