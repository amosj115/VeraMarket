"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MakeOfferForm({ conversationId, askingLabel }: { conversationId: string; askingLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/conversations/${conversationId}/offers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountRand: Number(amount) }) });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Could not send your offer."); return; }
    setAmount("");
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-blue-50">Make an offer</button>;
  return <form onSubmit={submit} className="flex flex-wrap items-center gap-2"><label className="text-sm text-slate-600">Offer (asking {askingLabel})</label><input type="number" min="1" step="0.01" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount in rand" className="w-40 rounded-md border border-border px-3 py-2 text-sm" /><button disabled={busy || !amount} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Sending..." : "Send offer"}</button><button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">Cancel</button>{error && <p className="w-full text-sm text-red-700">{error}</p>}</form>;
}