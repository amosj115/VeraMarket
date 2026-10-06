"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SavedSearchRow = { id: string; name: string; summary: string; href: string; alertsEnabled: boolean };

export function SavedSearchList({ searches }: { searches: SavedSearchRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function call(id: string, method: "PATCH" | "DELETE", body?: unknown) {
    setError(null);
    const response = await fetch(`/api/saved-searches/${id}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) { setError("That didn't work. Please try again."); return; }
    router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-white">
        {searches.map((s) => (
          <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><a href={s.href} className="font-medium text-brand hover:underline">{s.name}</a><p className="truncate text-xs text-slate-500">{s.summary}</p></div>
            <div className="flex shrink-0 items-center gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.alertsEnabled} onChange={(e) => call(s.id, "PATCH", { alertsEnabled: e.target.checked })} />Alerts</label>
              <button onClick={() => call(s.id, "DELETE")} className="text-red-700 hover:underline">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}