"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export function ListingActions({ listingId, title, priceCents }: { listingId: string; title: string; priceCents: number }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [message, setMessage] = useState("Hi, I'm interested in this item. Is it still available?");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offerAmount, setOfferAmount] = useState("");
  const [offerError, setOfferError] = useState<string | null>(null);

  // Generate offer suggestions based on listing price (5%, 10%, 15%, 20% off)
  const offerSuggestions = [
    Math.round(priceCents * 0.95),
    Math.round(priceCents * 0.90),
    Math.round(priceCents * 0.85),
    Math.round(priceCents * 0.80),
  ].filter((amount) => amount > 0);

  async function favorite() {
    if (!session) return router.push(`/login?callbackUrl=${encodeURIComponent(location.pathname)}`);
    setBusy(true);
    const response = await fetch(`/api/listings/${listingId}/favorite`, { method: "POST" });
    const data = await response.json();
    setStatus(response.ok ? (data.favorited ? "Saved to favorites" : "Removed from favorites") : data.error);
    setBusy(false);
  }

  async function contact() {
    if (!session) return router.push(`/login?callbackUrl=${encodeURIComponent(location.pathname)}`);
    if (!message.trim()) return setStatus("Write a message first.");
    setBusy(true);
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId,
        message,
        viaShare: sessionStorage.getItem("share-source") === `LISTING:${listingId}`,
      }),
    });
    const data = await response.json();
    setStatus(response.ok ? "Message sent" : data.error);
    if (response.ok) setMessage("Hi, I'm interested in this item. Is it still available?");
    setBusy(false);
  }

  async function makeOffer() {
    if (!session) return router.push(`/login?callbackUrl=${encodeURIComponent(location.pathname)}`);
    if (!offerAmount) return setOfferError("Enter an offer amount.");
    const amountCents = Math.round(Number(offerAmount) * 100);
    if (amountCents <= 0) return setOfferError("Enter an offer amount greater than zero.");
    setBusy(true);
    setOfferError(null);
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, message: `Offer: R${Number(offerAmount).toFixed(2)} for ${title}` }),
    });
    const data = await response.json();
    if (!response.ok) {
      setBusy(false);
      return setOfferError(data.error ?? "Could not start conversation.");
    }
    const conversationId = data.conversationId;
    const offerResponse = await fetch(`/api/conversations/${conversationId}/offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountRand: Number(offerAmount) }),
    });
    const offerData = await offerResponse.json();
    if (!offerResponse.ok) {
      setBusy(false);
      return setOfferError(offerData.error ?? "Could not send offer.");
    }
    setBusy(false);
    setOfferAmount("");
    router.refresh();
  }

  async function report() {
    if (!session) return router.push(`/login?callbackUrl=${encodeURIComponent(location.pathname)}`);
    const reason = window.prompt("Why are you reporting this listing?");
    if (!reason?.trim()) return;
    setBusy(true);
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "LISTING", targetId: listingId, reason }),
    });
    const data = await response.json();
    setStatus(response.ok ? "Report submitted for review." : data.error);
    setBusy(false);
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex gap-3">
        <button onClick={favorite} disabled={busy} className="flex-1 rounded-md border border-brand px-4 py-2.5 text-sm font-semibold text-brand hover:bg-brand-light">
          Save listing
        </button>
        <button onClick={() => document.getElementById("message-box")?.focus()} className="flex-1 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
          Contact seller
        </button>
      </div>
      <textarea
        id="message-box"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={`Ask ${title ? "the seller" : "a question"} something...`}
        rows={3}
        className="w-full rounded-md border border-border p-3 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
      />
      <button onClick={contact} disabled={busy} className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
        {busy ? "Sending..." : "Send message"}
      </button>
      <div className="rounded-md border border-border bg-white p-4">
        <p className="text-sm font-medium text-slate-700">Make an offer</p>
        <p className="mt-1 text-xs text-slate-500">Suggested offers for R{(priceCents / 100).toFixed(2)}:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {offerSuggestions.map((amount) => (
            <button
              key={amount}
              onClick={() => {
                setOfferAmount((amount / 100).toFixed(2));
                setOfferError(null);
              }}
              className="rounded-md border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-blue-50"
            >
              R{(amount / 100).toFixed(2)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            type="number"
            min="1"
            step="0.01"
            value={offerAmount}
            onChange={(e) => {
              setOfferAmount(e.target.value);
              setOfferError(null);
            }}
            placeholder="Custom amount (R)"
            className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-brand"
            inputMode="decimal"
          />
          <button onClick={makeOffer} disabled={busy || !offerAmount} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Sending..." : "Send offer"}
          </button>
        </div>
        {offerError && <p className="mt-2 text-sm text-red-700">{offerError}</p>}
      </div>
      <button onClick={report} disabled={busy} className="text-left text-xs font-medium text-slate-500 hover:text-red-700">
        Report this listing
      </button>
      {status && <p className="text-sm text-slate-600">{status}</p>}
    </div>
  );
}
