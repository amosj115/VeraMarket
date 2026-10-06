"use client";

import { useEffect } from "react";

export function ListingEngagementTracker({ listingId }: { listingId: string }) {
  useEffect(() => {
    const key = `listing-view:${listingId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    void fetch(`/api/listings/${listingId}/engagement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "VIEW" }),
      keepalive: true,
    });
  }, [listingId]);

  return null;
}