export default function TrendingLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8" aria-busy="true">
      <div className="mx-auto mb-7 max-w-5xl sm:mb-9">
        <p role="status" className="text-sm font-medium text-slate-500">Loading Trending listings…</p>
        <div className="mt-3 h-9 w-48 animate-pulse rounded bg-slate-100 sm:h-11" />
        <div className="mt-3 h-4 max-w-xl animate-pulse rounded bg-slate-100" />
      </div>
      <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border bg-white md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <div className="aspect-[4/3] animate-pulse bg-slate-100 md:aspect-auto md:min-h-[30rem]" />
        <div className="space-y-4 p-6 sm:p-8">
          <div className="h-3 w-36 animate-pulse rounded bg-slate-100" />
          <div className="h-8 w-4/5 animate-pulse rounded bg-slate-100" />
          <div className="h-8 w-1/2 animate-pulse rounded bg-slate-100" />
          <div className="mt-8 h-16 animate-pulse rounded bg-slate-100" />
          <div className="h-11 w-44 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
