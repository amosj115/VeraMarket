"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { TrendingItem } from "@/lib/trending";
import { formatZAR } from "@/lib/utils";
import { cdnImage } from "@/lib/image-url";

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

  return <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{items.map((item) => <TrendingCard key={item.id} item={item} />)}<div ref={sentinel} className="col-span-full py-4 text-center" aria-live="polite">{error ? <button onClick={() => { setError(""); setRetryCount((count) => count + 1); }} className="text-sm font-medium text-brand">{error}</button> : hasMore ? <span className="text-sm text-slate-500">{isLoading ? "Loading more listings..." : "Scroll to load more listings"}</span> : <span className="text-sm text-slate-500">You are up to date.</span>}</div></div>;
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

  return (
    <article ref={card} className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-white transition hover:shadow-md">
      <div className="relative block aspect-square bg-slate-100">
        <Link href={`/listing/${item.slug}`} className="absolute inset-0" aria-label={`View ${item.title}`}>
          {item.images[0] ? <Image src={cdnImage(item.images[0].url, 640)} alt={item.title} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No image</div>}
        </Link>
        {item.labels.length > 0 && <div className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex max-w-[calc(100%-0.75rem)] flex-col items-start gap-1">{item.labels.map((label) => <span key={label} className="truncate rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-foreground shadow-sm">{label}</span>)}</div>}
          <button type="button" disabled={busy} onClick={toggleSave} aria-pressed={saved} title={`${saveCount} saves`} aria-label={saved ? "Remove from saved listings" : "Save listing"} className="absolute bottom-1.5 left-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm ring-1 ring-black/5 backdrop-blur-sm hover:bg-white disabled:opacity-60">
          <svg viewBox="0 0 24 24" className={`h-4 w-4 ${saved ? "fill-brand stroke-brand" : "fill-none stroke-slate-700"}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
        </button>
          <button type="button" disabled={busy} onClick={toggleLike} aria-pressed={liked} title={`${likeCount} likes`} aria-label={liked ? "Unlike listing" : "Like listing"} className="absolute bottom-1.5 right-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm ring-1 ring-black/5 backdrop-blur-sm hover:bg-white disabled:opacity-60">
          <svg viewBox="0 0 24 24" className={`h-4 w-4 ${liked ? "fill-red-500 stroke-red-500" : "fill-none stroke-slate-700"}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" /></svg>
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        <div className="flex items-start gap-1">
          <Link href={`/listing/${item.slug}`} className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-tight text-foreground hover:text-brand">{item.title}</Link>
          <button type="button" onClick={share} title="Share listing" aria-label="Share listing" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>
          </button>
        </div>
        <p className="text-sm font-semibold text-brand">{formatZAR(item.priceCents)}</p>
        <p className="truncate text-[11px] leading-tight text-slate-500">{item.location}</p>
        <p className="truncate text-[11px] leading-tight text-slate-500">{item.seller.displayName}{item.seller.identityVerification === "VERIFIED" && <span className="ml-1 font-medium text-emerald-700">✓ Verified</span>}</p>
        <Link href={`/listing/${item.slug}#message-box`} onClick={() => { void fetch(`/api/listings/${item.id}/engagement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "CONTACT" }), keepalive: true }); }} className="mt-1 block w-full rounded-md bg-brand px-2 py-1 text-center text-[11px] font-semibold leading-tight text-white hover:bg-brand-dark">Contact seller</Link>
        {status && <p className="text-[10px] text-slate-500" role="status">{status}</p>}
      </div>
    </article>
  );
}