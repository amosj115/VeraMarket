"use client";

import { useState } from "react";

type Pack = { id: string; name: string; description: string | null; priceLabel: string; durationDays: number };
type Item = { id: string; title: string };

export function BuyBoost({ packages, listings }: { packages: Pack[]; listings: Item[] }) {
  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function buy(packageId: string) {
    setBusy(packageId);
    setError(null);
    const response = await fetch("/api/boosts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: "LISTING", targetId: listingId, packageId }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.authorizationUrl) { setError(data.error ?? "Could not start payment."); setBusy(null); return; }
    window.location.assign(data.authorizationUrl);
  }
  if (listings.length === 0) return <p className="text-sm text-slate-500">Create an active listing to boost it.</p>;
  return (
    <div>
      <label className="text-sm font-medium">Listing to boost<select value={listingId} onChange={(e) => setListingId(e.target.value)} className="mt-1 block w-full rounded-md border border-border px-3 py-2 text-sm">{listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{packages.map((p) => <button key={p.id} disabled={!!busy} onClick={() => buy(p.id)} className="rounded-lg border border-border p-4 text-left hover:border-brand disabled:opacity-60"><p className="font-semibold">{p.name} · {p.priceLabel}</p><p className="text-xs text-slate-500">{p.description ?? `${p.durationDays} days`}</p>{busy === p.id && <p className="mt-1 text-xs text-brand">Redirecting...</p>}</button>)}</div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}