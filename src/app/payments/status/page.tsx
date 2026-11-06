import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { PaymentStatusRefresher } from "@/components/payments/payment-status-refresher";

export const dynamic = "force-dynamic";

const COPY: Record<string, { title: string; body: string; tone: string }> = {
  PENDING: { title: "Payment pending", body: "We are waiting for the payment provider to confirm your payment. Nothing is activated until it is confirmed. This page updates automatically.", tone: "border-amber-200 bg-amber-50 text-amber-900" },
  SUCCEEDED: { title: "Payment confirmed", body: "Your payment was verified and your purchase is active.", tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  FAILED: { title: "Payment failed", body: "The payment did not go through. You were not charged and nothing was activated. You can try again.", tone: "border-red-200 bg-red-50 text-red-900" },
  CANCELLED: { title: "Payment cancelled", body: "The payment was cancelled. Nothing was activated and you were not charged.", tone: "border-slate-200 bg-slate-50 text-slate-800" },
  REFUNDED: { title: "Payment refunded", body: "This payment was refunded.", tone: "border-slate-200 bg-slate-50 text-slate-800" },
};

export default async function PaymentStatusPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref = "" } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/payments/status?ref=${ref}`)}`);
  const payment = ref
    ? await prisma.payment.findFirst({
        where: { providerRef: ref, userId: session.user.id },
        select: { status: true, purpose: true, amountCents: true, currency: true, providerRef: true, createdAt: true, boost: { select: { status: true, startsAt: true, expiresAt: true } }, subscription: { select: { status: true, expiresAt: true, renewsAt: true, autoRenew: true } } },
      })
    : null;
  if (!payment) {
    return <div className="mx-auto max-w-xl px-4 py-16 text-center"><h1 className="text-2xl font-semibold">Payment not found</h1><p className="mt-2 text-sm text-slate-500">We could not find that payment on your account.</p><Link href="/profile" className="mt-6 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Back to my account</Link></div>;
  }
  const copy = COPY[payment.status] ?? COPY.PENDING;
  const isBoost = payment.purpose === "BOOST";
  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <PaymentStatusRefresher active={payment.status === "PENDING"} />
      <div className={`rounded-lg border p-5 ${copy.tone}`}>
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm">{copy.body}</p>
      </div>
      <dl className="mt-6 space-y-2 rounded-lg border border-border bg-white p-5 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Purchase</dt><dd className="font-medium">{isBoost ? "Listing boost (one-time)" : "Virtual Store monthly subscription"}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Amount</dt><dd className="font-medium">{formatZAR(payment.amountCents)} {payment.currency}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Reference</dt><dd className="font-mono text-xs">{payment.providerRef}</dd></div>
        {isBoost && payment.status === "SUCCEEDED" && payment.boost?.expiresAt && <div className="flex justify-between gap-4"><dt className="text-slate-500">Boost ends</dt><dd className="font-medium">{payment.boost.expiresAt.toLocaleString("en-ZA")} (does not renew)</dd></div>}
        {!isBoost && payment.status === "SUCCEEDED" && payment.subscription && <div className="flex justify-between gap-4"><dt className="text-slate-500">Next payment</dt><dd className="font-medium">{payment.subscription.autoRenew ? (payment.subscription.renewsAt ?? payment.subscription.expiresAt)?.toLocaleDateString("en-ZA") : "Does not renew"}</dd></div>}
      </dl>
      <Link href={isBoost ? "/profile/boosts" : "/profile/shops"} className="mt-6 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">{isBoost ? "Back to boosts" : "Back to my stores"}</Link>
    </div>
  );
}
