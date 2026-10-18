"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
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
  images: Array<{ url: string }>;
  sellerId: string | null;
  sellerName: string | null;
  sellerUsername: string | null;
  sellerAvatarUrl: string | null;
  boosted: boolean;
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
const ONBOARDING_KEY = "vera-market-trending-onboarding";

export function TrendingFeed({
  initialItems,
  initialCursor,
  initialError,
}: {
  initialItems: TrendingFeedItem[];
  initialCursor: string | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [error, setError] = useState(initialError);
  const [isLoading, setIsLoading] = useState(false);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!session?.user) {
      setLikedIds(new Set());
      setSavedIds(new Set());
      return;
    }
    fetch("/api/listings/likes")
      .then((res) => res.json())
      .then((data) => setLikedIds(new Set(data.ids ?? [])))
      .catch(() => setLikedIds(new Set()));
    fetch("/api/favorites/bulk")
      .then((res) => res.json())
      .then((data) => setSavedIds(new Set(data.ids ?? [])))
      .catch(() => setSavedIds(new Set()));
  }, [session?.user]);
  const [restoreIndex, setRestoreIndex] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const savedIndex = Number(sessionStorage.getItem(FEED_POSITION_KEY));
      return Number.isSafeInteger(savedIndex) && savedIndex > 0 && savedIndex < 1000 ? savedIndex : null;
    } catch {
      return null;
    }
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const loadingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const dismissed = localStorage.getItem(ONBOARDING_KEY);
      if (dismissed === "true") return;
      if (initialItems.length > 0) {
        const timer = setTimeout(() => setShowOnboarding(true), 800);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage unavailable
    }
  }, [initialItems.length]);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch {
      // localStorage unavailable
    }
  }, []);

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

    const scrollContainer = scrollContainerRef.current;
    const mobileNav = document.querySelector<HTMLElement>("nav.fixed");
    const header = document.querySelector<HTMLElement>("header.sticky");
    const main = page.closest("main");

    const applyFeedHeights = () => {
      const available = page.getBoundingClientRect().height;
      const navigationHeight = mobileNav?.getBoundingClientRect().height ?? 0;
      const feedHeight = Math.max(0, Math.floor(available - navigationHeight));

      if (scrollContainer) {
        const current = scrollContainer.style.height;
        const next = `${feedHeight}px`;
        if (current !== next) scrollContainer.style.height = next;
      }

      const articles = scrollContainer?.querySelectorAll<HTMLElement>("[data-trending-feed-item]");
      articles?.forEach((article) => {
        const current = article.style.height;
        const next = `${feedHeight}px`;
        if (current !== next) article.style.height = next;
      });
    };

    applyFeedHeights();
    window.addEventListener("resize", applyFeedHeights);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(applyFeedHeights);
    if (observer) {
      if (header) observer.observe(header);
      if (main) observer.observe(main);
      if (scrollContainer) observer.observe(scrollContainer);
      if (mobileNav) observer.observe(mobileNav);
    }

    return () => {
      window.removeEventListener("resize", applyFeedHeights);
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
        className="snap-y snap-mandatory overflow-x-hidden overflow-y-auto overscroll-y-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
      {items.map((item, index) => (
        <TrendingFeedCard
          key={item.id}
          item={item}
          index={index}
          isLast={index === items.length - 1}
          hasMore={Boolean(nextCursor)}
          error={Boolean(error)}
          isLoading={isLoading}
          onLoadMore={() => void loadNextPage()}
          session={session}
          router={router}
          initialLiked={likedIds.has(item.id)}
          initialSaved={savedIds.has(item.id)}
        />
      ))}
      </div>

      {items.length > 0 && items[items.length - 1] && (
        <div ref={sentinelRef} aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px" />
      )}

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

      {showOnboarding && <OnboardingOverlay onDismiss={dismissOnboarding} />}
    </div>
  );
}

function TrendingFeedCard({
  item,
  index,
  isLast,
  hasMore,
  error,
  isLoading,
  onLoadMore,
  session,
  router,
  initialLiked,
  initialSaved,
}: {
  item: TrendingFeedItem;
  index: number;
  isLast: boolean;
  hasMore: boolean;
  error: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  session: any;
  router: any;
  initialLiked: boolean;
  initialSaved: boolean;
}) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [liked, setLiked] = useState(initialLiked);
  const [saved, setSaved] = useState(initialSaved);
  const [likeBusy, setLikeBusy] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);

  const images = item.images.length > 0 ? item.images : [{ url: "" }];

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const deltaX = e.touches[0].clientX - touchStartX.current;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Only mark as swiping when clear horizontal intent (2:1 ratio)
    // This prevents accidental photo changes during vertical scroll
    if (absX > 15 && absX > absY * 2) {
      isSwiping.current = true;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isSwiping.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Only treat as photo swipe if clearly horizontal
    if (absX < 50 || absY > absX * 1.5) return;
    if (currentImageIndex <= 0 && deltaX > 0) return;
    if (currentImageIndex >= images.length - 1 && deltaX < 0) return;

    setCurrentImageIndex((prev) => {
      if (deltaX > 0) return Math.max(0, prev - 1);
      return Math.min(images.length - 1, prev + 1);
    });
  }, [images.length, currentImageIndex]);

  const handleLike = useCallback(async () => {
    if (!session) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/listing/${item.slug}`)}`);
      return;
    }
    if (likeBusy) return;
    setLikeBusy(true);
    try {
      const response = await fetch(`/api/listings/${item.id}/like`, { method: "POST" });
      const data = await response.json();
      if (response.ok) setLiked(data.liked);
    } catch {
      // Handle error silently
    } finally {
      setLikeBusy(false);
    }
  }, [session, item.id, item.slug, router, likeBusy]);

  const handleSave = useCallback(async () => {
    if (!session) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/listing/${item.slug}`)}`);
      return;
    }
    try {
      const response = await fetch(`/api/listings/${item.id}/favorite`, { method: "POST" });
      const data = await response.json();
      if (response.ok) setSaved(data.favorited);
    } catch {
      // Handle error silently
    }
  }, [session, item.id, item.slug, router]);

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/listing/${item.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: item.title, url });
      } catch {
        // User cancelled or share failed
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        alert("Link copied to clipboard");
      } catch {
        // Clipboard unavailable
      }
    }
  }, [item.title, item.slug]);

  const handleMessage = useCallback(async () => {
    if (!session) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/listing/${item.slug}`)}`);
      return;
    }
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: item.id, sellerId: item.sellerId }),
      });
      const data = await response.json();
      if (response.ok && data.conversationId) {
        router.push(`/messages/${data.conversationId}`);
      } else {
        router.push(`/messages?listingId=${item.id}&sellerUsername=${item.sellerUsername ?? ""}`);
      }
    } catch {
      router.push(`/messages?listingId=${item.id}&sellerUsername=${item.sellerUsername ?? ""}`);
    }
  }, [session, item.id, item.sellerId, item.slug, item.sellerUsername, router]);

  return (
    <article data-trending-feed-item data-trending-index={index} className="relative flex w-full shrink-0 snap-start snap-always items-center justify-center px-0 py-0 md:px-3 md:py-3">
      <div className="relative h-full w-full overflow-hidden bg-slate-950 md:max-w-5xl">
        <div
          className="relative h-full w-full"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {images[currentImageIndex]?.url ? (
            <Image
              src={cdnImage(images[currentImageIndex].url, 1200)}
              alt={item.title}
              fill
              sizes="(max-width: 767px) 100vw, (max-width: 1280px) 58vw, 720px"
              preload={index === 0}
              className="object-cover object-center md:object-contain"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center px-6 text-sm text-slate-300">
              No listing image available
            </span>
          )}

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-16 md:p-6 md:pt-20">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                {item.boosted && (
                  <span className="mb-1 inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-amber-950">
                    Boosted
                  </span>
                )}
                <h2 className="line-clamp-2 text-lg font-semibold leading-tight text-white md:text-2xl">
                  {item.title}
                </h2>
                <p className="mt-1 text-xl font-bold text-white md:text-2xl">
                  {formatZAR(item.priceCents)}
                </p>
                <p className="mt-1 truncate text-xs text-slate-300">
                  {CONDITION_LABELS[item.condition] ?? item.condition}
                  {item.areaName || item.location ? ` · ${item.areaName || item.location}` : ""}
                </p>
                {item.sellerName && (
                  <p className="mt-1 truncate text-xs text-white/70">
                    by {item.sellerName}
                  </p>
                )}
              </div>
            </div>
          </div>

          {images.length > 1 && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
              {currentImageIndex + 1} / {images.length}
            </div>
          )}
        </div>

        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 md:right-5">
          {item.sellerUsername && (
            <Link
              href={`/u/${item.sellerUsername}`}
              aria-label={`Visit ${item.sellerName ?? "seller"}`}
              title={item.sellerName ?? "Visit seller"}
              className="flex flex-col items-center gap-1"
            >
              {item.sellerAvatarUrl ? (
                <Image
                  src={cdnImage(item.sellerAvatarUrl, 96)}
                  alt={item.sellerName ?? "Seller"}
                  width={44}
                  height={44}
                  className="h-11 w-11 rounded-full border-2 border-white object-cover shadow-md"
                />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-brand text-sm font-semibold text-white shadow-md">
                  {(item.sellerName ?? "S").charAt(0)}
                </span>
              )}
            </Link>
          )}
          <ActionButton
            label={liked ? "Unlike" : "Like"}
            onClick={handleLike}
            disabled={likeBusy}
            active={liked}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </ActionButton>
          <ActionButton label="Message" onClick={handleMessage}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </ActionButton>
          <ActionButton
            label={saved ? "Unsave" : "Save"}
            onClick={handleSave}
            active={saved}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </ActionButton>
          <ActionButton label="Share" onClick={handleShare}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </ActionButton>
        </div>

        <div className="absolute bottom-20 left-0 right-0 flex justify-center md:bottom-24">
          {isLast && !hasMore && !error && (
            <span role="status" className="text-xs text-white/60">You're all caught up.</span>
          )}
        </div>
      </div>
    </article>
  );
}

function ActionButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-full border shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 ${
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-white text-slate-700 hover:border-brand hover:text-brand"
      }`}
    >
      {children}
    </button>
  );
}

function OnboardingOverlay({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= 2) {
      const timer = setTimeout(onDismiss, 3000);
      return () => clearTimeout(timer);
    }
  }, [step, onDismiss]);

  const nextStep = () => {
    if (step < 2) setStep((s) => s + 1);
    else onDismiss();
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={nextStep}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-brand/10">
          {step === 0 && (
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-brand" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5" />
              <path d="m5 12 7-7 7 7" />
            </svg>
          )}
          {step === 1 && (
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-brand" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 9l-3 3 3 3" />
              <path d="M9 5l3-3 3 3" />
              <path d="M15 19l-3 3-3-3" />
              <path d="M19 9l3 3-3 3" />
              <line x1="2" y1="12" x2="22" y2="12" />
            </svg>
          )}
          {step === 2 && (
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-brand" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
              <path d="M9 6l6 6-6 6" />
            </svg>
          )}
        </div>
        <h3 className="text-lg font-semibold text-foreground">
          {step === 0 ? "Swipe up & down" : step === 1 ? "Swipe left & right" : "Ready to explore!"}
        </h3>
        <p className="mt-2 text-sm text-slate-500">
          {step === 0
            ? "Scroll vertically to discover different listings"
            : step === 1
              ? "Swipe horizontally to see more photos of the same listing"
              : "Start exploring trending listings now"}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          {step === 2 ? "Start exploring" : "Got it"}
        </button>
        <div className="mt-3 flex justify-center gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? "bg-brand" : "bg-slate-300"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
