import { auth } from "@/auth";
import { formatZAR } from "@/lib/utils";
import { activePro, getProPlan } from "@/lib/pro";
import { integrations } from "@/lib/config";
import { SubscribeButton } from "@/components/pro/subscribe-button";

export const dynamic = "force-dynamic";

export default async function ProPage() {
  const session = await auth();
  const [plan, current] = await Promise.all([getProPlan(), session?.user ? activePro(session.user.id) : null]);
  const features = (plan?.features ?? {}) as { savedSearchLimit?: number; advancedAnalytics?: boolean };
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <p className="text-sm font-medium text-brand">Vera Pro</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Sell smarter</h1>
      {!plan ? <p className="mt-6 text-sm text-slate-500">Vera Pro is not available right now.</p> : (
        <div className="mt-6 rounded-lg border border-border bg-white p-6">
          <p className="text-2xl font-semibold">{formatZAR(plan.priceCents)}<span className="text-sm font-normal text-slate-500"> / 30 days</span></p>
          <ul className="mt-4 space-y-2 text-sm text-slate-700"><li>✓ Up to {features.savedSearchLimit ?? 0} saved searches with alerts</li>{features.advancedAnalytics && <li>✓ Per-listing performance analytics on your dashboard</li>}</ul>
          <div className="mt-6">
            {current ? <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Vera Pro is active until {current.currentPeriodEnd?.toLocaleDateString("en-ZA")}.</p> : !integrations.paystack.configured ? <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">Payments are not configured in this environment yet, so Vera Pro can&apos;t be purchased.</p> : <SubscribeButton label={`Get ${plan.name}`} />}
          </div>
          <p className="mt-4 text-xs text-slate-500">Each payment covers 30 days and does not renew automatically. Pro only activates after Paystack confirms payment to our server.</p>
        </div>
      )}
    </div>
  );
}