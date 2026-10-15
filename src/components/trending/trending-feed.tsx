"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cdnImage } from "@/lib/image-url";
import { formatZAR } from "@/lib/utils";

type TrendingFeedItem = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  condition: string;
  location: string;
  areaName: string | null;
  imageUrl: string | null;
  sellerName: string | null;
};

type TrendingFeedResponse = {
  items: TrendingFeedItem[];
  nextCursor: string | null;
};

const CONDITION_LABELS: Record<string, string> = {
  NEW: "New",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  FOR_PARTS: "For parts",
};

const FEED_POSITION_KEY = "vera-market-trending-position";

export function TrendingFeed({
  initialItems,
  initialCursor,
  initialError,
}: {
  initialItems: TrendingFeedItem[];
  initialCursor: string | null;
  initialError: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [error, setError] = useState(initialError);
  const [isLoading, setIsLoading] = useState(false);
  const [restoreIndex, setRestoreIndex] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const savedIndex = Number(sessionStorage.getItem(FEED_POSITION_KEY));
      return Number.isSafeInteger(savedIndex) && savedIndex > 0 && savedIndex < 1000 ? savedIndex : null;
    } catch {
      return null;
    }
  });
  const loadingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadNextPage = useCallback(async () => {
    const canRetryInitialPage = items.length === 0 && Boolean(error);
    if (loadingRef.current || (!nextCursor && !canRetryInitialPage)) return;

    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (nextCursor) params.set("cursor", nextCursor);
      const query = params.toString();
      const suffix = query ? `?${query}` : "";
      const response = await fetch(`/api/trending${suffix}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as
        | (Partial<TrendingFeedResponse> & { error?: string })
        | null;

      if (!response.ok) throw new Error(payload?.error ?? "Trending listings could not be loaded.");
      if (!payload || !Array.isArray(payload.items) || (payload.nextCursor !== null && typeof payload.nextCursor !== "string")) {
        throw new Error("Trending listings could not be loaded.");
      }

      const pageItems = payload.items as TrendingFeedItem[];
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        const unseen = pageItems.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        return [...current, ...unseen];
      });
      setNextCursor(payload.nextCursor);
    } catch {
      setError("Trending listings could not be loaded. Please try again.");
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, [error, items.length, nextCursor]);

  useLayoutEffect(() => {
    const page = document.querySelector<HTMLElement>("[data-trending-page]");
    if (!page) return;

    const mobileNav = document.querySelector<HTMLElement>("nav.fixed");
    const header = document.querySelector<HTMLElement>("header.sticky");
    const main = page.closest("main");
    const measureAvailableHeight = () => {
      const top = page.getBoundingClientRect().top;
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      const bottom = isMobile && mobileNav
        ? mobileNav.getBoundingClientRect().top
        : window.innerHeight;
      const height = `${Math.max(0, Math.floor(bottom - top))}px`;
      if (page.style.height !== height) page.style.height = height;
    };

    measureAvailableHeight();
    window.addEventListener("resize", measureAvailableHeight);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureAvailableHeight);
    if (observer) {
      if (header) observer.observe(header);
      if (main) observer.observe(main);
      if (mobileNav) observer.observe(mobileNav);
    }

    return () => {
      window.removeEventListener("resize", measureAvailableHeight);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (restoreIndex === null) return;

    if (restoreIndex < items.length) {
      const frame = requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (container) {
          container.scrollTo({ top: restoreIndex * container.clientHeight, behavior: "instant" });
        }
        setRestoreIndex(null);
      });
      return () => cancelAnimationFrame(frame);
    }

    if (error) return;

    if (nextCursor) {
      if (!isLoading) {
        const frame = requestAnimationFrame(() => void loadNextPage());
        return () => cancelAnimationFrame(frame);
      }
      return;
    }

    const frame = requestAnimationFrame(() => {
      try {
        sessionStorage.removeItem(FEED_POSITION_KEY);
      } catch {
        // Ignore storage cleanup failures.
      }
      setRestoreIndex(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [error, isLoading, items.length, loadNextPage, nextCursor, restoreIndex]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!sentinel || !scrollContainer || !nextCursor || error || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadNextPage();
    }, { root: scrollContainer, rootMargin: "0px 0px 480px 0px" });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, loadNextPage, nextCursor]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-dashed border-border bg-white px-6 py-10 text-center md:py-16">
          {error ? (
            <>
              <h2 className="text-lg font-semibold text-foreground">Trending listings could not be loaded</h2>
              <p role="alert" className="mx-auto mt-2 max-w-md text-sm text-slate-500">{error}</p>
              <button type="button" onClick={() => void loadNextPage()} disabled={isLoading} className="mt-5 inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
                {isLoading ? "Trying again..." : "Try again"}
              </button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-foreground">No active listings yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                New listings will appear here after they are approved and available in the marketplace.
              </p>
              <Link href="/marketplace" className="mt-5 inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
                Browse the marketplace
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 w-full md:mx-auto md:max-w-6xl">
      <div
        ref={scrollContainerRef}
        role="region"
        aria-label="Trending listings feed"
        onScroll={(event) => {
          const container = event.currentTarget;
          const index = Math.max(0, Math.round(container.scrollTop / Math.max(container.clientHeight, 1)));
          try {
            sessionStorage.setItem(FEED_POSITION_KEY, String(index));
          } catch {
            // Position restoration is best effort only.
          }
        }}
        className="h-full min-h-0 snap-y snap-mandatory overflow-x-hidden overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
      {items.map((item, index) => (
        <article key={item.id} data-trending-feed-item data-trending-index={index} className="relative flex h-full min-h-full w-full shrink-0 snap-start snap-always items-center justify-center px-0 py-0 md:px-3 md:py-3">
          <div className="grid h-full w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-white md:h-[min(72vh,44rem)] md:max-h-full md:max-w-5xl md:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)] md:grid-rows-1 md:rounded-2xl md:border md:border-border md:shadow-lg">
            <Link
              href={`/listing/${item.slug}`}
              aria-label={`View listing details for ${item.title}`}
              className="relative min-h-0 min-w-0 overflow-hidden bg-slate-950"
            >
              {item.imageUrl ? (
                <Image
                  src={cdnImage(item.imageUrl, 1200)}
                  alt={item.title}
                  fill
                  sizes="(max-width: 767px) 100vw, (max-width: 1280px) 58vw, 720px"
                  preload={index === 0}
                  className="object-contain p-2 sm:p-4 md:p-6"
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center px-6 text-sm text-slate-300">
                  No listing image available
                </span>
              )}
            </Link>

            <div className="flex min-h-0 min-w-0 flex-col justify-center overflow-hidden px-4 py-3 sm:px-6 md:px-8 md:py-6 lg:px-10">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand md:text-xs">Marketplace listing</p>
              <h2 className="mt-1 line-clamp-2 text-lg font-semibold leading-tight tracking-tight text-foreground sm:text-xl md:mt-3 md:text-3xl">
                {item.title}
              </h2>
              <p className="mt-1 text-xl font-bold tracking-tight text-brand sm:text-2xl md:mt-4 md:text-3xl">
                {formatZAR(item.priceCents)}
              </p>

              <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs md:mt-5 md:flex-col md:gap-y-3 md:border-t md:border-border md:pt-5 md:text-sm">
                <div className="flex flex-wrap gap-x-1.5">
                  <dt className="font-medium text-slate-500">Condition</dt>
                  <dd className="text-slate-800">{CONDITION_LABELS[item.condition] ?? item.condition}</dd>
                </div>
                {item.sellerName && (
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt className="font-medium text-slate-500">Seller</dt>
                    <dd className="text-slate-800">{item.sellerName}</dd>
                  </div>
                )}
                {(item.areaName || item.location) && (
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt className="font-medium text-slate-500">Location</dt>
                    <dd className="text-slate-800">{item.areaName || item.location}</dd>
                  </div>
                )}
              </dl>

              <Link
                href={`/listing/${item.slug}`}
                className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand md:mt-7 md:min-h-11 md:px-5 md:py-2.5"
              >
                View listing details <span aria-hidden="true">→</span>
              </Link>
              {index === items.length - 1 && nextCursor && !error && (
                <button
                  type="button"
                  onClick={() => void loadNextPage()}
                  disabled={isLoading}
                  className="mt-2 inline-flex min-h-10 items-center justify-center self-start rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60 md:mt-3 md:min-h-11"
                >
                  {isLoading ? "Loading..." : "Load more listings"}
                </button>
              )}
              {index === items.length - 1 && !nextCursor && !error && (
                <span role="status" className="mt-2 self-start text-xs text-slate-500">You’re all caught up.</span>
              )}
            </div>
          </div>
          {index === items.length - 1 && nextCursor && (
            <div ref={sentinelRef} aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px" />
          )}
        </article>
      ))}
      </div>

      {error && (
        <div role="alert" className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/95 p-3 text-xs text-amber-950 shadow-sm md:bottom-5 md:left-5 md:right-5 md:max-w-lg md:text-sm">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void loadNextPage()}
            disabled={isLoading}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-2 font-semibold hover:bg-amber-100 disabled:opacity-60"
          >
            {isLoading ? "Trying again…" : "Try again"}
          </button>
        </div>
      )}

      {isLoading && items.length > 0 && (
        <p role="status" className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1.5 text-xs text-slate-600 shadow md:bottom-6 md:text-sm">
          Loading more listings…
        </p>
      )}
    </div>
  );
}
