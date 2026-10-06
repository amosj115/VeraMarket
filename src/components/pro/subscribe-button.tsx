"use client";

import { useState } from "react";

export function SubscribeButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/pro", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.href = "/login?callbackUrl=/pro"; return; }
    if (!response.ok || !data.authorizationUrl) { setError(data.error ?? "Could not start payment."); setBusy(false); return; }
    window.location.assign(data.authorizationUrl);
  }
  return <div><button onClick={go} disabled={busy} className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Redirecting..." : label}</button>{error && <p className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}