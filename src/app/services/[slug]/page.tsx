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
  const card = await getShareCard("SERVICE", slug);
  return card ? cardMetadata(card, slug) : unavailableMetadata;
}

export default async function ServiceDetailPage({ params }: Props) {
  const { slug } = await params;
  const service = await prisma.serviceListing.findUnique({
    where: { slug },
    include: {
      category: true,
      provider: {
        select: {
          username: true,
          displayName: true,
          identityVerification: true,
          profileVerification: true,
          createdAt: true,
        },
      },
      reviews: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { displayName: true } } },
      },
    },
  });
  if (!service || service.status !== "ACTIVE") notFound();
  return <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8"><Link href="/services" className="text-sm font-medium text-brand">← Back to services</Link><div className="mt-6 border-b border-border pb-8"><p className="text-sm font-medium text-brand">{service.category.name}</p><div className="flex items-start justify-between gap-3"><h1 className="mt-1 text-3xl font-semibold tracking-tight">{service.title}</h1><ShareButton target="SERVICE" targetId={service.id} url={publicUrl(appUrl(), "SERVICE", service.slug)} title={service.title} variant="subtle" className="shrink-0" /></div><SharedLinkTracker target="SERVICE" targetId={service.id} /><p className="mt-3 text-2xl font-semibold text-brand">{service.priceCents == null ? "Request a quote" : formatZAR(service.priceCents)} <span className="text-sm font-normal text-slate-500">{service.priceCents == null ? "" : `· ${service.pricingType.toLowerCase()}`}</span></p><p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-600">{service.description}</p><div className="mt-6 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2"><div><p className="text-xs text-slate-500">Service area</p><p className="mt-1 font-medium">{service.serviceArea}</p></div><div><p className="text-xs text-slate-500">Location</p><p className="mt-1 font-medium">{service.location}</p></div></div><FollowButton kind="seller" id={service.providerId} label="Follow provider" /><FavoriteToggle targetType="SERVICE" targetId={service.id} /></div><section className="mt-6 rounded-lg border border-border bg-white p-5"><p className="text-xs text-slate-500">Provider</p><p className="mt-1 font-semibold"><Link href={`/u/${service.provider.username}`} className="hover:text-brand">{service.provider.displayName}</Link> <VerifiedBadge verified={service.provider.profileVerification === "VERIFIED"} /></p><p className="text-sm text-slate-500">@{service.provider.username}</p>{service.provider.identityVerification === "VERIFIED" && <p className="mt-2 text-xs font-medium text-emerald-700">Verified identity</p>}</section><section className="mt-8"><h2 className="text-xl font-semibold">Reviews</h2>{service.reviews.length === 0 ? <p className="mt-3 text-sm text-slate-500">No reviews yet.</p> : service.reviews.map((review) => <article key={review.id} className="mt-3 rounded-lg border border-border p-4"><p className="text-sm font-medium">{review.author.displayName} · {review.rating}/5</p><p className="mt-2 text-sm text-slate-600">{review.comment}</p></article>)}</section></div>;
}
