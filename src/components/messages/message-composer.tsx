"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MessageComposer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/conversations/${conversationId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Message could not be sent."); setBusy(false); return; }
    setBody("");
    setBusy(false);
    router.refresh();
  }

  return <form onSubmit={submit} className="border-t border-border pt-4"><div className="flex gap-3"><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={2} maxLength={2000} placeholder="Write a message..." className="min-w-0 flex-1 rounded-md border border-border p-3 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand" /><button disabled={busy || !body.trim()} className="self-end rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Sending..." : "Send"}</button></div>{error && <p className="mt-2 text-sm text-red-700">{error}</p>}</form>;
}
