import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { ListingManageActions } from "@/components/listings/listing-manage-actions";

export const dynamic = "force-dynamic";

export default async function MyListingsPage({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  const { submitted } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/profile/listings");
  const listings = await prisma.listing.findMany({ where: { sellerId: session.user.id }, orderBy: { updatedAt: "desc" }, include: { images: { take: 1, orderBy: { sortOrder: "asc" } }, category: { select: { name: true } } } });
  return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-brand">Your account</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">My listings</h1><p className="mt-2 text-sm text-slate-500">Manage the products you have added to Vera Market.</p></div><Link href="/sell" className="rounded-md bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-dark">Create listing</Link></div>{submitted === "1" && <p role="status" className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Your listing was submitted for review. It will appear publicly after approval.</p>}{listings.length === 0 ? <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-16 text-center"><p className="font-medium">No listings yet</p><p className="mt-1 text-sm text-slate-500">Your listings will appear here after you create them.</p></div> : <div className="mt-8 overflow-hidden rounded-lg border border-border bg-white">{listings.map((listing) => <div key={listing.id} className="flex flex-col gap-4 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center"><div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-slate-100">{listing.images[0] && <img src={listing.images[0].url} alt="" className="h-full w-full object-cover" />}</div><div className="min-w-0 flex-1"><Link href={`/listing/${listing.slug}`} className="font-medium hover:text-brand">{listing.title}</Link><p className="mt-1 text-sm text-brand">{formatZAR(listing.priceCents)} · {listing.category.name}</p><p className="mt-1 text-xs text-slate-500">Status: {listing.status.replaceAll("_", " ")}</p></div><ListingManageActions listingId={listing.id} status={listing.status} /></div>)}</div>}</div>;
}
