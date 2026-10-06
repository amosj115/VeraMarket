import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/profile");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      _count: { select: { listings: true, shops: true, services: true, properties: true, favorites: true, listingLikes: true } },
      notifications: { where: { readAt: null }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-5 border-b border-border pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-brand">Your profile</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{user.displayName}</h1>
          <p className="mt-1 text-sm text-slate-500">@{user.username} · Member since {user.createdAt.toLocaleDateString("en-ZA", { month: "short", year: "numeric" })}</p>
          <p className="mt-4 max-w-xl text-sm text-slate-600">{user.bio || "Add a short introduction to help people know who they are dealing with."}</p>
        </div>
        <div className="flex gap-2"><Link href="/profile/listings" className="rounded-md bg-brand px-4 py-2 text-center text-sm font-semibold text-white hover:bg-brand-dark">My listings</Link><Link href="/profile/settings" className="rounded-md border border-border px-4 py-2 text-center text-sm font-semibold text-slate-700 hover:border-brand hover:text-brand">Edit profile</Link></div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Listings" value={user._count.listings} />
        <Stat label="Shops" value={user._count.shops} />
        <Stat label="Services" value={user._count.services} />
        <Stat label="Properties" value={user._count.properties} />
        <Stat label="Favorites" value={user._count.favorites} />
        <Stat label="Liked listings" value={user._count.listingLikes} />
      </div>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
        <Link href="/profile/listings" className="text-brand">Manage listings</Link>
        <Link href="/profile/favorites" className="text-brand">Favorites</Link>
        <Link href="/profile/saved" className="text-brand">Saved listings</Link>
        <Link href="/profile/liked" className="text-brand">Liked listings</Link>
        <Link href="/profile/shops" className="text-brand">Manage shops</Link>
        <Link href="/profile/services" className="text-brand">Manage services</Link>
        <Link href="/profile/properties" className="text-brand">Manage properties</Link>
        <Link href="/profile/boosts" className="text-brand">Boosts</Link><Link href="/dashboard" className="text-brand">Seller dashboard</Link><Link href="/profile/searches" className="text-brand">Saved searches</Link><Link href="/pro" className="text-brand">Vera Pro</Link>
        <Link href="/messages" className="text-brand">Messages</Link>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-white p-5">
          <h2 className="font-semibold">Verification</h2>
          <p className="mt-1 text-sm text-slate-500">Trust signals are only shown when they have been completed.</p>
          <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm"><span>Verified Person (photo match)</span><Status value={user.profileVerification} /></div>
          {user.profileVerification !== "VERIFIED" && <p className="mt-2 text-xs text-amber-700">Profile verification required to buy, sell, message and open a Virtual Store. <Link href="/onboarding/profile" className="font-semibold underline">Verify now</Link></p>}
          <div className="mt-3 flex items-center justify-between text-sm"><span>Identity verification</span><Status value={user.identityVerification} /></div>
          <div className="mt-3 flex items-center justify-between text-sm"><span>Phone verification</span><Status value={user.phoneVerification} /></div>
          <Link href="/profile/verification" className="mt-5 inline-block text-sm font-medium text-brand">Manage verification</Link>
        </section>
        <section className="rounded-lg border border-border bg-white p-5">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Notifications</h2><Link href="/notifications" className="text-sm font-medium text-brand">View all</Link></div>
          {user.notifications.length === 0 ? <p className="mt-6 text-sm text-slate-500">No unread notifications.</p> : <div className="mt-4 space-y-3">{user.notifications.map((notification) => <div key={notification.id} className="border-t border-border pt-3"><p className="text-sm font-medium">{notification.title}</p><p className="mt-1 text-xs text-slate-500">{notification.body}</p></div>)}</div>}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-border bg-white p-4"><p className="text-2xl font-semibold text-brand">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>; }
function Status({ value }: { value: string }) { const label = value === "NOT_VERIFIED" ? "Not verified" : value.charAt(0) + value.slice(1).toLowerCase(); return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{label}</span>; }
