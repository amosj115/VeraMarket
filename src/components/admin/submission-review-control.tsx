"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TargetType = "LISTING" | "SHOP" | "SERVICE" | "PROPERTY";
export function SubmissionReviewControl({ targetType, targetId }: { targetType: TargetType; targetId: string }) { const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); async function decide(decision: "APPROVE" | "REJECT") { setBusy(true); setError(null); const response = await fetch("/api/admin/moderation", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType, targetId, decision }) }); const data = await response.json(); if (!response.ok) setError(data.error ?? "Could not save moderation decision."); else router.refresh(); setBusy(false); } return <div className="shrink-0"><div className="flex gap-2"><button disabled={busy} onClick={() => decide("REJECT")} className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-red-700 hover:border-red-300 disabled:opacity-60">Reject</button><button disabled={busy} onClick={() => decide("APPROVE")} className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60">Approve</button></div>{error && <p role="alert" className="mt-2 max-w-48 text-right text-xs text-red-700">{error}</p>}</div>; }
