"use client";

import { useEffect } from "react";
import type { ShareTarget } from "@/lib/share";

// Counts a visit that arrived through a Vera Market share link (?src=share), once per browser session.
export function SharedLinkTracker({ target, targetId }: { target: ShareTarget; targetId: string }) {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("src") !== "share") return;
    const key = `share-view:${target}:${targetId}`;
    sessionStorage.setItem("share-source", `${target}:${targetId}`);
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    void fetch("/api/share/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: target, targetId, kind: "LINK_VIEW" }), keepalive: true }).catch(() => {});
  }, [target, targetId]);
  return null;
}