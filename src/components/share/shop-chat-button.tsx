"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export function ShopChatButton({ shopId, shopName }: { shopId: string; shopName: string }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(`Hi! I'm interested in products from ${shopName}.`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const viaShare = sessionStorage.getItem("share-source") === `SHOP:${shopId}`;
    const response = await fetch(`/api/shops/${shopId}/contact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, viaShare }) });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(data.error ?? "Could not send your message.");
    router.push(`/messages/${data.conversationId}`);
  }

  function start() {
    if (!session) return router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
    setOpen(true);
  }

  return (
    <div>
      <button type="button" onClick={start} className="rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">Chat with shop</button>
      {open && (
        <div className="mt-3 max-w-md rounded-lg border border-border bg-white p-3">
          <label htmlFor="shop-chat-message" className="text-sm font-medium">Message</label>
          <textarea id="shop-chat-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm" />
          {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
          <div className="mt-2 flex gap-2"><button type="button" disabled={busy || !message.trim()} onClick={send} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Sending..." : "Send"}</button><button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button></div>
        </div>
      )}
    </div>
  );
}