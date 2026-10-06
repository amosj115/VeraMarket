"use client";

import { useState } from "react";

export function SaveSearchButton({ query, categorySlug, label }: { query: string; categorySlug: string; label: string }) {
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("busy");
    setError(null);
    const response = await fetch("/api/saved-searches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: label.slice(0, 80), query: query || undefined, categorySlug: categorySlug || undefined }) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.href = "/login?callbackUrl=/marketplace"; return; }
    if (!response.ok) { setError(data.error ?? "Could not save this search."); setState("idle"); return; }
    setState("saved");
  }

  return <div className="mt-3 text-sm">{state === "saved" ? <span className="text-emerald-700">Search saved. We&apos;ll notify you about new matches. <a className="underline" href="/profile/searches">Manage</a></span> : <button onClick={save} disabled={state === "busy"} className="font-medium text-brand hover:underline disabled:opacity-60">{state === "busy" ? "Saving..." : "Save this search & get alerts"}</button>}{error && <span className="ml-3 text-red-700">{error}</span>}</div>;
}