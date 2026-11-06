import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Read-only payment visibility for staff. Shows references and statuses only: no credentials,
// card tokens or card details are selected from the database. Refunds are processed in the
// payment provider's dashboard; a payment marked REFUNDED is shown here once recorded.
export default async function AdminPaymentsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  const [payments, events, subs] = await Promise.all([
    prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, providerRef: true, provider: true, purpose: true, kind: true, status: true, amountCents: true, currency: true, failureReason: true, createdAt: true, user: { select: { username: true } } } }),
    prisma.paymentWebhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 50, select: { id: true, provider: true, providerRef: true, outcome: true, receivedAt: true } }),
    prisma.shopSubscription.findMany({ orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, status: true, autoRenew: true, renewsAt: true, expiresAt: true, cancelledAt: true, renewalAttempts: true, lastRenewalError: true, shop: { select: { name: true } } } }),
  ]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-sm font-medium text-brand">Admin payments</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Payments</h1>
      <h2 className="mt-8 font-semibold">Recent payments</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Reference</th><th className="p-3">User</th><th className="p-3">Purpose</th><th className="p-3">Status</th><th className="p-3">Amount</th><th className="p-3">Date</th></tr></thead>
          <tbody>{payments.map((p) => <tr key={p.id} className="border-t border-border"><td className="p-3 font-mono">{p.providerRef}<span className="block text-slate-400">{p.provider}</span></td><td className="p-3">@{p.user.username}</td><td className="p-3">{p.purpose.replaceAll("_", " ")}{p.kind === "RENEWAL" ? " (renewal)" : ""}</td><td className="p-3 font-medium">{p.status}{p.failureReason ? <span className="block font-normal text-red-700">{p.failureReason}</span> : null}</td><td className="p-3">{formatZAR(p.amountCents)} {p.currency}</td><td className="p-3">{p.createdAt.toLocaleString("en-ZA")}</td></tr>)}</tbody>
        </table>
        {payments.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No payments yet.</p>}
      </div>
      <h2 className="mt-8 font-semibold">Virtual Store subscriptions</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Store</th><th className="p-3">Status</th><th className="p-3">Auto-renew</th><th className="p-3">Next billing</th><th className="p-3">Expires</th><th className="p-3">Failed attempts</th></tr></thead>
          <tbody>{subs.map((s) => <tr key={s.id} className="border-t border-border"><td className="p-3">{s.shop.name}</td><td className="p-3 font-medium">{s.status}</td><td className="p-3">{s.autoRenew ? "Yes" : s.cancelledAt ? "Cancelled" : "No"}</td><td className="p-3">{s.autoRenew ? s.renewsAt?.toLocaleDateString("en-ZA") ?? "-" : "-"}</td><td className="p-3">{s.expiresAt?.toLocaleDateString("en-ZA") ?? "-"}</td><td className="p-3">{s.renewalAttempts}{s.lastRenewalError ? ` (${s.lastRenewalError})` : ""}</td></tr>)}</tbody>
        </table>
      </div>
      <h2 className="mt-8 font-semibold">Webhook events</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Received</th><th className="p-3">Provider</th><th className="p-3">Reference</th><th className="p-3">Outcome</th></tr></thead>
          <tbody>{events.map((e) => <tr key={e.id} className="border-t border-border"><td className="p-3">{e.receivedAt.toLocaleString("en-ZA")}</td><td className="p-3">{e.provider}</td><td className="p-3 font-mono">{e.providerRef ?? "-"}</td><td className="p-3">{e.outcome}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
