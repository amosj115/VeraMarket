"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export function ListingActions({ listingId, title }: { listingId: string; title: string }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function favorite() {
    if (!session) return router.push(`/login?callbackUrl=${encodeURIComponent(location.pathname)}`);
    setBusy(true); const response = await fetch(`/api/listings/${listingId}/favorite`, { method: "POST" }); const data = await response.json(); setStatus(response.ok ? (data.favorited ? "Saved to favorites" : "Removed from favorites") : data.error); setBusy(false);
  }
  async function contact() {
    if (!session) return router.push(`/login?callbackUrl=${encodeURIComponent(location.pathname)}`);
    if (!message.trim()) return setStatus("Write a message first.");
    setBusy(true); const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, message, viaShare: sessionStorage.getItem("share-source") === `LISTING:${listingId}` }) }); const data = await response.json(); setStatus(response.ok ? "Message sent" : data.error); if (response.ok) setMessage(""); setBusy(false);
  }
  async function report() {
    if (!session) return router.push(`/login?callbackUrl=${encodeURIComponent(location.pathname)}`);
    const reason = window.prompt("Why are you reporting this listing?");
    if (!reason?.trim()) return;
    setBusy(true); const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: "LISTING", targetId: listingId, reason }) }); const data = await response.json(); setStatus(response.ok ? "Report submitted for review." : data.error); setBusy(false);
  }
  return <div className="mt-6 space-y-3"><div className="flex gap-3"><button onClick={favorite} disabled={busy} className="flex-1 rounded-md border border-brand px-4 py-2.5 text-sm font-semibold text-brand hover:bg-brand-light">Save listing</button><button onClick={() => document.getElementById("message-box")?.focus()} className="flex-1 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Message seller</button></div><textarea id="message-box" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Ask ${title ? "the seller" : "a question"} something...`} rows={3} className="w-full rounded-md border border-border p-3 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand" /><button onClick={contact} disabled={busy} className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">{busy ? "Sending..." : "Send message"}</button><button onClick={report} disabled={busy} className="text-left text-xs font-medium text-slate-500 hover:text-red-700">Report this listing</button>{status && <p className="text-sm text-slate-600">{status}</p>}</div>;
}
