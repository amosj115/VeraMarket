"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Target = { id: string; username: string; role: string; status: string; activeHold: { reason: string } | null };

// Admin controls for a single account: place a hold (with a required reason), lift an
// active hold, or delete the account (with a required reason). Every action confirms
// first and is server-side enforced; the acting admin is always taken from the session.
export function AccountManagement({ user, selfId }: { user: Target; selfId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"hold" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Self-deletion and self-hold are blocked in the API too, but hide them here as well.
  const isSelf = user.id === selfId;

  async function run(action: "hold" | "lift" | "delete", body: object) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/accounts", {
      method: action === "hold" ? "POST" : action === "lift" ? "PATCH" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Something went wrong."); return; }
    setMode(null);
    setReason("");
    router.refresh();
  }

  if (mode) {
    const isDelete = mode === "delete";
    return (
      <form
        onSubmit={(event) => { event.preventDefault(); void run(mode, { userId: user.id, reason }); }}
        className="flex w-full shrink-0 flex-col gap-2 sm:w-72"
      >
        <p className="text-sm font-semibold text-slate-700">{isDelete ? `Delete @${user.username}` : `Hold @${user.username}`}</p>
        <p className="text-xs text-slate-500">{isDelete ? "This permanently removes the account and its personal data. Some records are retained for moderation and legal reasons." : "The account cannot log in and its listings are hidden until the hold is lifted."}</p>
        <textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={isDelete ? "Reason for deletion" : "Reason for the hold"} className="w-full rounded-md border border-border p-2 text-sm outline-none focus:border-brand" />
        {error && <p className="text-xs text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button disabled={busy} className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${isDelete ? "bg-red-600 hover:bg-red-700" : "bg-brand hover:bg-brand-dark"}`}>{busy ? "Working..." : isDelete ? "Confirm delete" : "Confirm hold"}</button>
          <button type="button" disabled={busy} onClick={() => { setMode(null); setReason(""); setError(null); }} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 sm:items-end">
      {error && <p className="text-xs text-red-700">{error}</p>}
      {user.activeHold ? (
        <button disabled={busy || isSelf} onClick={() => { if (window.confirm(`Lift the hold on @${user.username}? Their account and hidden listings will be restored.`)) void run("lift", { userId: user.id }); }} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Working..." : "Lift hold"}</button>
      ) : (
        <>
          <button disabled={busy || isSelf} onClick={() => setMode("hold")} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:border-brand disabled:opacity-60">Place on hold</button>
          <button disabled={busy || isSelf} onClick={() => setMode("delete")} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:border-red-400 hover:bg-red-50 disabled:opacity-60">Delete account</button>
        </>
      )}
    </div>
  );
}
