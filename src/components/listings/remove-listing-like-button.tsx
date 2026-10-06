"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RemoveListingLikeButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const response = await fetch(`/api/listings/${listingId}/like`, { method: "POST" });
    if (response.ok) router.refresh();
    setBusy(false);
  }

  return <button type="button" disabled={busy} onClick={remove} className="rounded-md border border-border px-3 py-2 text-xs font-medium text-slate-600 hover:border-red-300 hover:text-red-700 disabled:opacity-60">{busy ? "Updating..." : "Unlike"}</button>;
}