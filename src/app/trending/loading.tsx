export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-8 w-56 rounded bg-slate-200" />
      <div className="mt-2 h-4 w-80 rounded bg-slate-100" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-border bg-white">
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
