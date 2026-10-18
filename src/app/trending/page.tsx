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
    <div data-trending-page className="h-[calc(100dvh-3.5rem)] w-full overflow-hidden md:h-[calc(100dvh-2rem)] md:px-6">
      <section aria-label="Active marketplace listings" className="h-full w-full">
        <TrendingFeed
          initialItems={initialPage.items}
          initialCursor={initialPage.nextCursor}
          initialError={initialError}
        />
      </section>
    </div>
  );
}
