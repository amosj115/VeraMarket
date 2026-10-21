import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { cdnImage } from "@/lib/image-url";
import { ServicePhotoGallery } from "@/components/services/service-photo-gallery";
import { FavoriteToggle } from "@/components/favorites/favorite-toggle";
import { FollowButton } from "@/components/follow/follow-button";
import { VerifiedBadge } from "@/components/profile/verified-badge";
import { appUrl } from "@/lib/app-url";
import { publicUrl } from "@/lib/share";
import { cardMetadata, getShareCard, unavailableMetadata } from "@/lib/share-meta";
import { ShareButton } from "@/components/share/share-button";
import { SharedLinkTracker } from "@/components/share/shared-link-tracker";
import { publicServiceWhere } from "@/lib/content-visibility";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const card = await getShareCard("SERVICE", slug);
  return card ? cardMetadata(card, slug) : unavailableMetadata;
}

export default async function ServiceDetailPage({ params }: Props) {
  const { slug } = await params;
  const service = await prisma.serviceListing.findFirst({
    where: { slug, ...publicServiceWhere() },
    include: {
      category: true,
      images: {
        where: { ownerType: "SERVICE" },
        orderBy: { sortOrder: "asc" },
        select: { id: true, url: true },
      },
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
  if (!service) notFound();
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <Link href="/services" className="text-sm font-medium text-brand hover:underline">
        ← Back to services
      </Link>

      <div className="relative mt-5 aspect-[16/8] max-h-[30rem] overflow-hidden rounded-2xl bg-gradient-to-br from-blue-50 to-slate-100 sm:aspect-[16/7]">
        {service.coverImageUrl ? (
          <Image
            src={cdnImage(service.coverImageUrl, 1600)}
            alt={`${service.title} business cover`}
            fill
            sizes="(max-width: 640px) 100vw, 960px"
            className="object-cover"
            preload
          />
        ) : (
          <div className="flex h-full items-center justify-center px-5 text-center text-sm text-slate-500">
            This provider hasn&apos;t added a cover photo yet.
          </div>
        )}
      </div>

      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="min-w-0">
          <p className="text-sm font-medium text-brand">{service.category.name}</p>
          <div className="mt-1 flex items-start justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{service.title}</h1>
            <ShareButton
              target="SERVICE"
              targetId={service.id}
              url={publicUrl(appUrl(), "SERVICE", service.slug)}
              title={service.title}
              variant="subtle"
              className="shrink-0"
            />
          </div>
          <SharedLinkTracker target="SERVICE" targetId={service.id} />
          <p className="mt-2 text-sm text-slate-500">
            Provided by{" "}
            <Link href={`/u/${service.provider.username}`} className="font-medium text-slate-700 hover:text-brand">
              {service.provider.displayName}
            </Link>
            <VerifiedBadge verified={service.provider.profileVerification === "VERIFIED"} />
          </p>
          <p className="mt-4 text-2xl font-semibold text-brand">
            {service.priceCents == null ? "Request a quote" : formatZAR(service.priceCents)}
            <span className="text-sm font-normal text-slate-500">
              {service.priceCents == null ? "" : ` · ${service.pricingType.toLowerCase()}`}
            </span>
          </p>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-600">
            {service.description}
          </p>
          <div className="mt-6 grid gap-4 border-y border-border py-5 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-500">Service area</p>
              <p className="mt-1 font-medium">{service.serviceArea}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Location</p>
              <p className="mt-1 font-medium">{service.location}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <FollowButton kind="seller" id={service.providerId} label="Follow provider" />
            <FavoriteToggle targetType="SERVICE" targetId={service.id} />
          </div>
        </section>

        <aside className="h-fit rounded-xl border border-border bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Service provider</p>
          <p className="mt-2 font-semibold">
            <Link href={`/u/${service.provider.username}`} className="hover:text-brand">
              {service.provider.displayName}
            </Link>
          </p>
          <p className="mt-1 text-sm text-slate-500">@{service.provider.username}</p>
          {service.provider.identityVerification === "VERIFIED" && (
            <p className="mt-3 text-xs font-medium text-emerald-700">Verified identity</p>
          )}
        </aside>
      </div>

      <ServicePhotoGallery title={service.title} photos={service.images} />

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Reviews</h2>
        {service.reviews.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No reviews yet.</p>
        ) : (
          service.reviews.map((review) => (
            <article key={review.id} className="mt-3 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">
                {review.author.displayName} · {review.rating}/5
              </p>
              <p className="mt-2 text-sm text-slate-600">{review.comment}</p>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
