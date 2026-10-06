"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type OfferView = { id: string; amountLabel: string; status: string; madeByMe: boolean; iAmSeller: boolean; expiresAt: string };

const statusStyle: Record<string, string> = { PENDING: "bg-amber-100 text-amber-800", ACCEPTED: "bg-emerald-100 text-emerald-800", COMPLETED: "bg-emerald-100 text-emerald-800", DECLINED: "bg-red-100 text-red-700", COUNTERED: "bg-slate-200 text-slate-700", CANCELLED: "bg-slate-200 text-slate-700", EXPIRED: "bg-slate-200 text-slate-700" };

export function OfferCard({ offer, disabled }: { offer: OfferView; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countering, setCountering] = useState(false);
  const [counter, setCounter] = useState("");
  const pending = offer.status === "PENDING" && new Date(offer.expiresAt) > new Date();

  async function act(action: string, amountRand?: number) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/offers/${offer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, amountRand }) });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Could not update the offer."); return; }
    setCountering(false);
    router.refresh();
  }

  const button = "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-60";
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-white p-4 text-slate-800 shadow-sm">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{offer.madeByMe ? "Your offer" : "Offer received"}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusStyle[offer.status] ?? ""}`}>{offer.status === "PENDING" && !pending ? "EXPIRED" : offer.status}</span></div>
      <p className="mt-1 text-xl font-semibold">{offer.amountLabel}</p>
      {pending && !disabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          {offer.madeByMe ? <button disabled={busy} onClick={() => act("CANCEL")} className={`${button} border border-border`}>Withdraw</button> : <>
            <button disabled={busy} onClick={() => act("ACCEPT")} className={`${button} bg-emerald-600 text-white`}>Accept</button>
            <button disabled={busy} onClick={() => act("DECLINE")} className={`${button} border border-border`}>Decline</button>
            <button disabled={busy} onClick={() => setCountering((v) => !v)} className={`${button} border border-border`}>Counter</button>
          </>}
        </div>
      )}
      {countering && <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); act("COUNTER", Number(counter)); }}><input type="number" min="1" step="0.01" required value={counter} onChange={(e) => setCounter(e.target.value)} placeholder="Amount (R)" className="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5 text-sm" /><button disabled={busy} className={`${button} bg-brand text-white`}>Send</button></form>}
      {offer.status === "ACCEPTED" && offer.iAmSeller && !disabled && <button disabled={busy} onClick={() => act("COMPLETE")} className={`${button} mt-3 bg-brand text-white`}>Confirm sale completed</button>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}