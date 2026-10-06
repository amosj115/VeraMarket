"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SaveSearchButton({ query, categorySlug, label }: { query: string; categorySlug: string; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("busy");
    setError(null);
    try {
      const response = await fetch("/api/saved-searches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: label.slice(0, 80), query: query || undefined, categorySlug: categorySlug || undefined }) });
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 401) { router.push("/login?callbackUrl=/marketplace"); return; }
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "Could not save this search.";
        setError(message);
        setState("idle");
        return;
      }
      setState("saved");
    } catch {
      setError("Could not save this search. Please try again.");
      setState("idle");
    }
  }

  return <div className="mt-3 text-sm">{state === "saved" ? <span className="text-emerald-700">Search saved. We&apos;ll notify you about new matches. <Link className="underline" href="/profile/searches">Manage</Link></span> : <button onClick={save} disabled={state === "busy"} className="font-medium text-brand hover:underline disabled:opacity-60">{state === "busy" ? "Saving..." : "Save this search & get alerts"}</button>}{error && <span className="ml-3 text-red-700">{error}</span>}</div>;
}