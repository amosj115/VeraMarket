"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ChatActions({ conversationId, otherUserId, blockedByMe, archived }: { conversationId: string; otherUserId: string; blockedByMe: boolean; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [reported, setReported] = useState(false);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "That didn't work. Please try again."); return false; }
    return true;
  }

  async function toggleBlock() {
    if (!blockedByMe && !window.confirm("Block this user? They won't be able to message you.")) return;
    if (await call(`/api/users/${otherUserId}/block`, blockedByMe ? "DELETE" : "POST")) router.refresh();
  }
  async function toggleArchive() {
    if (await call(`/api/conversations/${conversationId}`, "PATCH", { archived: !archived })) router.push("/messages");
  }
  async function report(event: React.FormEvent) {
    event.preventDefault();
    if (await call("/api/reports", "POST", { targetType: "USER", targetId: otherUserId, reason: reason.trim() })) { setReported(true); setReporting(false); }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <button disabled={busy} onClick={toggleArchive} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-slate-50">{archived ? "Unarchive" : "Archive"}</button>
      <button disabled={busy} onClick={toggleBlock} className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-slate-50">{blockedByMe ? "Unblock user" : "Block user"}</button>
      {reported ? <span className="text-emerald-700">Report sent. Our team will review it.</span> : <button disabled={busy} onClick={() => setReporting((v) => !v)} className="rounded-md border border-border px-3 py-1.5 font-medium text-red-700 hover:bg-red-50">Report user</button>}
      {reporting && <form onSubmit={report} className="flex w-full gap-2"><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={120} required placeholder="What's wrong? (e.g. scam attempt)" className="min-w-0 flex-1 rounded-md border border-border px-3 py-1.5" /><button disabled={busy || reason.trim().length < 3} className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white disabled:opacity-60">Send report</button></form>}
      {error && <p className="w-full text-red-700">{error}</p>}
    </div>
  );
}