export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse px-4 py-4 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <div className="h-7 w-40 rounded bg-slate-200" />
        <div className="h-8 w-28 rounded-md bg-slate-200" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-9 rounded-lg bg-slate-100" />
        <div className="flex gap-2">
          <div className="h-8 w-32 rounded-md bg-slate-100" />
          <div className="h-8 w-28 rounded-md bg-slate-100" />
          <div className="h-8 w-28 rounded-md bg-slate-200" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-white">
            <div className="aspect-square bg-slate-200" />
            <div className="space-y-2 p-3">
              <div className="h-4 rounded bg-slate-100" />
              <div className="h-4 w-1/2 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
