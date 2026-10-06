import Link from "next/link";
import { auth } from "@/auth";
import { TrendingFeed } from "@/components/trending/trending-feed";
import { getTrendingPage } from "@/lib/trending";

export const dynamic = "force-dynamic";

export default async function TrendingPage() {
  const session = await auth();
  const page = await getTrendingPage(session?.user?.id);

  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
    <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
      <div><p className="text-sm font-semibold text-brand">Vera Market discovery</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Trending for You</h1><p className="mt-2 max-w-xl text-sm text-slate-500">Listings gaining real attention across Vera Market, shaped by your interests and area.</p></div>
      <Link href="/marketplace" className="text-sm font-semibold text-brand">Search marketplace</Link>
    </div>
    <TrendingFeed initialPage={page} />
  </main>;
}