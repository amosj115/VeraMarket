import type { Metadata } from "next";
import { TrendingFeed } from "@/components/trending/trending-feed";
import { getTrendingFeedPage, type TrendingFeedPage } from "@/lib/trending-feed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trending",
  description: "Browse active marketplace listings on Vera Market.",
};

export default async function TrendingPage() {
  let initialPage: TrendingFeedPage = { items: [], nextCursor: null };
  let initialError: string | null = null;

  try {
    initialPage = await getTrendingFeedPage();
  } catch {
    initialError = "Trending listings could not be loaded. Please try again.";
  }

  return (
    <div data-trending-page className="-mb-16 mx-auto flex h-[calc(100dvh_-_8rem)] w-full max-w-7xl flex-col overflow-hidden md:mb-0 md:h-[calc(100dvh_-_4rem)] md:px-6 md:pt-3">
      <header className="shrink-0 px-4 py-2 md:mx-auto md:w-full md:max-w-5xl md:px-0 md:pb-4 md:pt-2">
        <p className="hidden text-sm font-semibold text-brand md:block">Discover on Vera Market</p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground md:mt-1 md:text-3xl">Trending</h1>
        <p className="mt-0.5 text-xs leading-4 text-slate-600 md:mt-2 md:max-w-2xl md:text-sm md:leading-6">
          Browse available finds from real marketplace sellers. Open a listing to see its full details and contact the seller.
        </p>
      </header>

      <section aria-label="Active marketplace listings" className="min-h-0 flex-1">
        <TrendingFeed
          initialItems={initialPage.items}
          initialCursor={initialPage.nextCursor}
          initialError={initialError}
        />
      </section>
    </div>
  );
}
