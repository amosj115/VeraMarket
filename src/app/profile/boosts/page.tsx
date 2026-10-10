import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";
import { formatZAR } from "@/lib/utils";
import { boostAnalytics, listBoostPackages } from "@/lib/boosts";
import { BuyBoost } from "@/components/pro/buy-boost";

export const dynamic = "force-dynamic";

export default async function BoostsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/profile/boosts");
  const userId = session.user.id;
  const [boosts, allPackages, listings] = await Promise.all([
    prisma.boost.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50, include: { payment: { select: { status: true } }, package: { select: { name: true } }, listing: { select: { title: true } } } }),
    listBoostPackages(),
    prisma.listing.findMany({ where: { sellerId: userId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true } }),
  ]);
  // Unpriced packages (price 0) are never offered for sale; the API rejects them too.
  const packages = allPackages.filter((p) => p.priceCents > 0);
  const analytics = await Promise.all(boosts.map((boost) => (boost.status === "ACTIVE" || boost.status === "EXPIRED" ? boostAnalytics(boost) : null)));
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Boosts</h1>
      <p className="mt-2 text-sm text-slate-500">Boosted listings rank first in the marketplace by visibility weight: 100% beats 50%, which beats the 25% Virtual Store baseline. Paid promotion is non-recurring and only activates after server-side payment verification.</p>
      {!integrations.paystack.configured ? <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Boost payments are not configured in this environment. No payment will be accepted.</div> : <div className="mt-6 rounded-lg border border-border bg-white p-5"><BuyBoost listings={listings} packages={packages.map((p) => ({ id: p.id, name: p.name, description: p.description, durationDays: p.durationDays, priceLabel: formatZAR(p.priceCents) }))} /></div>}
      <div className="mt-8 rounded-lg border border-border bg-white">
        {boosts.length === 0 ? <p className="px-6 py-16 text-center text-sm text-slate-500">No boost history yet.</p> : boosts.map((boost, i) => { const a = analytics[i]; return (
          <div key={boost.id} className="border-b border-border p-5 last:border-b-0">
            <div className="flex items-center justify-between gap-4"><div><p className="font-medium">{boost.listing?.title ?? boost.targetType.replaceAll("_", " ")} · {boost.package?.name ?? boost.duration.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">Payment: {boost.payment?.status ?? "Pending"}{boost.expiresAt ? ` · ${boost.status === "ACTIVE" ? "ends" : "ended"} ${boost.expiresAt.toLocaleDateString("en-ZA")}` : ""}</p></div><span className="text-xs font-medium text-slate-600">{boost.status.replaceAll("_", " ")}</span></div>
            {a && <p className="mt-2 text-xs text-slate-600">{a.views} views · {a.saves} saves · {a.conversations} chats · {a.offers} offers during boost</p>}
          </div>); })}
      </div>
    </div>
  );
}