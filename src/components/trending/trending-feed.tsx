"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { TrendingItem } from "@/lib/trending";
import { formatZAR } from "@/lib/utils";

type FeedPage = { items: TrendingItem[]; hasMore: boolean; nextOffset: number };

export function TrendingFeed({ initialPage }: { initialPage: FeedPage }) {
  const [items, setItems] = useState(initialPage.items);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const nextOffset = useRef(initialPage.nextOffset);
  const loading = useRef(false);
  const seenIds = useRef(new Set(initialPage.items.map((item) => item.id)));
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore || error) return;
    async function loadNextPage() {
      if (loading.current) return;
      loading.current = true;
      setIsLoading(true);
      try {
        const response = await fetch(`/api/trending?offset=${nextOffset.current}`);
        if (!response.ok) throw new Error("Could not load more listings.");
        const page = await response.json() as FeedPage;
        const newItems = page.items.filter((item) => !seenIds.current.has(item.id));
        for (const item of newItems) seenIds.current.add(item.id);
        setItems((current) => [...current, ...newItems]);
        nextOffset.current = page.nextOffset;
        setHasMore(page.hasMore);
      } catch {
        setError("Could not load more listings. Try again.");
      } finally {
        loading.current = false;
        setIsLoading(false);
      }
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadNextPage();
    }, { rootMargin: "500px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [error, hasMore, retryCount]);

  if (!items.length) {
    return <div className="mt-8 border-y border-border py-14 text-center"><p className="font-semibold">No active listings yet</p><p className="mt-1 text-sm text-slate-500">New and popular listings will appear here as Vera Market grows.</p><Link href="/marketplace" className="mt-4 inline-block text-sm font-semibold text-brand">Browse the marketplace</Link></div>;
  }

  return <div className="mt-8 space-y-6">{items.map((item) => <TrendingCard key={item.id} item={item} />)}<div ref={sentinel} className="py-4 text-center" aria-live="polite">{error ? <button onClick={() => { setError(""); setRetryCount((count) => count + 1); }} className="text-sm font-medium text-brand">{error}</button> : hasMore ? <span className="text-sm text-slate-500">{isLoading ? "Loading more listings..." : "Scroll to load more listings"}</span> : <span className="text-sm text-slate-500">You are up to date.</span>}</div></div>;
}

function TrendingCard({ item }: { item: TrendingItem }) {
  const router = useRouter();
  const [liked, setLiked] = useState(item.liked);
  const [saved, setSaved] = useState(item.saved);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [saveCount, setSaveCount] = useState(item.saveCount);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [viewRecorded, setViewRecorded] = useState(false);
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    const target = card.current;
    if (!target || viewRecorded) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setViewRecorded(true);
      const key = `listing-view:${item.id}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      void fetch(`/api/listings/${item.id}/engagement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "VIEW" }),
        keepalive: true,
      });
      observer.disconnect();
    }, { threshold: 0.55 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [item.id, viewRecorded]);

  async function toggleLike() {
    if (busy) return;
    setBusy(true);
    const response = await fetch(`/api/listings/${item.id}/like`, { method: "POST" });
    const data = await response.json();
    if (response.status === 401) return router.push(`/login?callbackUrl=${encodeURIComponent("/trending")}`);
    if (response.ok) { setLiked(data.liked); setLikeCount(data.count); setStatus(data.liked ? "Added to liked listings" : "Removed from liked listings"); }
    else setStatus(data.error ?? "Could not update like.");
    setBusy(false);
  }

  async function toggleSave() {
    if (busy) return;
    setBusy(true);
    const response = await fetch(`/api/listings/${item.id}/favorite`, { method: "POST" });
    const data = await response.json();
    if (response.status === 401) return router.push(`/login?callbackUrl=${encodeURIComponent("/trending")}`);
    if (response.ok) { setSaved(data.favorited); setSaveCount((count) => Math.max(0, count + (data.favorited ? 1 : -1))); setStatus(data.favorited ? "Saved listing" : "Removed from saved listings"); }
    else setStatus(data.error ?? "Could not update saved listings.");
    setBusy(false);
  }

  async function share() {
    const url = `${window.location.origin}/listing/${item.slug}`;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else { await navigator.clipboard.writeText(url); setStatus("Listing link copied"); }
      void fetch(`/api/listings/${item.id}/engagement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "SHARE" }), keepalive: true });
    } catch {
      setStatus("Could not share this listing.");
    }
  }

  return <article ref={card} className="grid overflow-hidden rounded-lg border border-border bg-white md:grid-cols-[1.15fr_0.85fr]">
    <Link href={`/listing/${item.slug}`} className="relative block aspect-[4/3] bg-slate-100 md:aspect-auto md:min-h-[22rem]" aria-label={`View ${item.title}`}>
      {item.images[0] ? <img src={item.images[0].url} alt={item.title} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">No image</div>}
      {item.labels.length > 0 && <div className="absolute left-3 top-3 flex flex-wrap gap-2">{item.labels.map((label) => <span key={label} className="rounded-sm bg-white/95 px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm">{label}</span>)}</div>}
    </Link>
    <div className="flex flex-col p-4 sm:p-6">
      <p className="text-xs font-semibold uppercase text-brand">{item.category.name}</p>
      <Link href={`/listing/${item.slug}`} className="mt-2 text-xl font-semibold leading-snug text-foreground hover:text-brand">{item.title}</Link>
      <p className="mt-3 text-2xl font-semibold text-brand">{formatZAR(item.priceCents)}</p>
      <p className="mt-2 text-sm text-slate-500">{item.location}</p>
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs text-slate-500">Seller</p>
        <p className="mt-1 text-sm font-semibold">{item.seller.displayName} <span className="font-normal text-slate-500">@{item.seller.username}</span></p>
        {item.seller.identityVerification === "VERIFIED" && <p className="mt-1 text-xs font-medium text-emerald-700">Identity verified</p>}
      </div>
      <div className="mt-auto pt-5">
        <div className="flex flex-wrap gap-2 border-y border-border py-3">
          <button type="button" disabled={busy} onClick={toggleLike} aria-pressed={liked} className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:border-brand hover:text-brand disabled:opacity-60">{liked ? "Liked" : "Like"} · {likeCount}</button>
          <button type="button" disabled={busy} onClick={toggleSave} aria-pressed={saved} className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:border-brand hover:text-brand disabled:opacity-60">{saved ? "Saved" : "Save"} · {saveCount}</button>
          <button type="button" onClick={share} title="Share listing" className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:border-brand hover:text-brand">Share</button>
        </div>
        <Link href={`/listing/${item.slug}#message-box`} onClick={() => { void fetch(`/api/listings/${item.id}/engagement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "CONTACT" }), keepalive: true }); }} className="mt-3 block rounded-md bg-brand px-4 py-3 text-center text-sm font-semibold text-white hover:bg-brand-dark">Contact seller</Link>
        {status && <p className="mt-2 text-xs text-slate-500" role="status">{status}</p>}
      </div>
    </div>
  </article>;
}