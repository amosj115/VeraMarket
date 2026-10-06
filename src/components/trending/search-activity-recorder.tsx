"use client";

import { useEffect } from "react";

export function SearchActivityRecorder({ query, categorySlug }: { query: string; categorySlug: string }) {
  useEffect(() => {
    if (query.trim().length < 3 && !categorySlug) return;
    void fetch("/api/search-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, categorySlug: categorySlug || undefined }),
      keepalive: true,
    });
  }, [categorySlug, query]);

  return null;
}