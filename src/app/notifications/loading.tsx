export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-8 w-52 rounded bg-slate-200" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg border border-border bg-white p-4">
            <div className="h-11 w-11 rounded-full bg-slate-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 rounded bg-slate-100" />
              <div className="h-3 w-2/3 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
