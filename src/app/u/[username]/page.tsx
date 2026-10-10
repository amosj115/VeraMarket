import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { getTrust } from "@/lib/trust";
import { activeShopFilter } from "@/lib/shops";
import { VerifiedBadge } from "@/components/profile/verified-badge";
import { appUrl } from "@/lib/app-url";
import { publicUrl } from "@/lib/share";
import { ShareButton } from "@/components/share/share-button";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const user = await prisma.user.findFirst({ where: { username, status: "ACTIVE" }, select: { displayName: true } });
  return { title: user ? user.displayName : "Profile not found" };
}

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params;
  const user = await prisma.user.findFirst({
    where: { username: username.toLowerCase(), status: "ACTIVE" },
    select: {
      id: true, displayName: true, username: true, avatarUrl: true, bio: true, location: true, createdAt: true, profileVerification: true, phoneVerification: true,
      listings: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, slug: true, title: true, priceCents: true, location: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } },
      shops: { where: activeShopFilter(), orderBy: { createdAt: "desc" }, select: { id: true, slug: true, name: true, description: true } },
      services: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, slug: true, title: true, serviceArea: true } },
      properties: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, slug: true, title: true, priceCents: true, location: true } },
    },
  });
  if (!user) notFound();

  const reviews = await prisma.review.aggregate({ where: { subjectId: user.id }, _avg: { rating: true }, _count: { _all: true } });
  const verified = user.profileVerification === "VERIFIED";
  const trust = await getTrust(user.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start gap-5 border-b border-border pb-8 sm:flex-row sm:items-center">
        {user.avatarUrl ? (
          <Image src={user.avatarUrl} alt={user.displayName} width={96} height={96} sizes="96px" className="h-24 w-24 rounded-full bg-slate-100 object-cover" />
        ) : (
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-light text-3xl font-semibold text-brand">{user.displayName[0]}</span>
        )}
        <div>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">{user.displayName}</h1><ShareButton target="PROFILE" targetId={user.id} url={publicUrl(appUrl(), "PROFILE", user.username)} title={user.displayName} label="Share profile" variant="subtle" /></div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {verified ? <VerifiedBadge verified size="md" /> : <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">Profile not verified</span>}{trust && <span title={trust.signals.map((s) => s.label).join(", ")} className="ml-2 rounded-full bg-brand-light px-3 py-1 text-sm font-medium text-brand">Trust {trust.score}/100 · {trust.tier}</span>}
            {user.phoneVerification === "VERIFIED" && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">Phone verified</span>}
          </div>
          <p className="mt-2 text-sm text-slate-500">@{user.username} · Member since {user.createdAt.toLocaleDateString("en-ZA", { month: "long", year: "numeric" })}{user.location ? ` · ${user.location}` : ""}</p>
          {user.bio && <p className="mt-3 max-w-2xl text-sm text-slate-600">{user.bio}</p>}
          {reviews._count._all > 0 && reviews._avg.rating !== null && <p className="mt-2 text-sm text-slate-600">{reviews._avg.rating.toFixed(1)} / 5 from {reviews._count._all} review{reviews._count._all === 1 ? "" : "s"}</p>}
        </div>
      </div>

      <p className="mt-6 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
        {verified ? "Verified Person means this member appears to match their real profile photo. It is not a government ID check." : "This member hasn't completed profile verification. Take extra care, keep conversations on Vera Market, and arrange payment and collection directly with the other person when you meet."}
      </p>

      {user.shops.length > 0 && (
        <Section title="Virtual Stores">
          <div className="grid gap-3 sm:grid-cols-2">{user.shops.map((shop) => <Link key={shop.id} href={`/shops/${shop.slug}`} className="rounded-lg border border-border bg-white p-4 hover:border-brand"><p className="font-semibold">{shop.name}</p><p className="mt-1 line-clamp-2 text-sm text-slate-500">{shop.description}</p></Link>)}</div>
        </Section>
      )}
      {user.listings.length > 0 && (
        <Section title="Listings">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {user.listings.map((listing) => (
              <Link key={listing.id} href={`/listing/${listing.slug}`} className="overflow-hidden rounded-lg border border-border bg-white hover:shadow-md">
                <div className="relative aspect-square bg-slate-100">{listing.images[0] && <Image src={listing.images[0].url} alt={listing.title} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" />}</div>
                <div className="p-3"><p className="truncate text-sm font-medium">{listing.title}</p><p className="mt-0.5 text-sm font-semibold text-brand">{formatZAR(listing.priceCents)}</p><p className="truncate text-xs text-slate-500">{listing.location}</p></div>
              </Link>
            ))}
          </div>
        </Section>
      )}
      {user.services.length > 0 && (
        <Section title="Services">
          <ul className="space-y-2">{user.services.map((service) => <li key={service.id}><Link href={`/services/${service.slug}`} className="block rounded-lg border border-border bg-white p-4 hover:border-brand"><span className="font-medium">{service.title}</span><span className="block text-sm text-slate-500">{service.serviceArea}</span></Link></li>)}</ul>
        </Section>
      )}
      {user.properties.length > 0 && (
        <Section title="Property listings">
          <ul className="space-y-2">{user.properties.map((property) => <li key={property.id}><Link href={`/real-estate/${property.slug}`} className="block rounded-lg border border-border bg-white p-4 hover:border-brand"><span className="font-medium">{property.title}</span><span className="block text-sm text-slate-500">{formatZAR(property.priceCents)} · {property.location}</span></Link></li>)}</ul>
        </Section>
      )}
      {!user.shops.length && !user.listings.length && !user.services.length && !user.properties.length && <p className="mt-10 text-center text-sm text-slate-500">This member has no active listings yet.</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-8"><h2 className="mb-3 text-lg font-semibold">{title}</h2>{children}</section>;
}
