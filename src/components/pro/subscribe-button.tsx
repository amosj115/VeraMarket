"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SubscribeButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pro", { method: "POST" });
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 401) { router.push("/login?callbackUrl=/pro"); return; }
      const authorizationUrl =
        payload &&
        typeof payload === "object" &&
        "authorizationUrl" in payload &&
        typeof payload.authorizationUrl === "string"
          ? payload.authorizationUrl
          : null;
      if (!response.ok || !authorizationUrl) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "Could not start payment.";
        setError(message);
        setBusy(false);
        return;
      }
      window.location.assign(authorizationUrl);
    } catch {
      setError("Could not start payment. Please try again.");
      setBusy(false);
    }
  }
  return <div><button onClick={go} disabled={busy} className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Redirecting..." : label}</button>{error && <p className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}