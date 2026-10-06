"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RemoveFavoriteButton({ favoriteId }: { favoriteId: string }) { const router = useRouter(); const [busy, setBusy] = useState(false); async function remove() { setBusy(true); const response = await fetch(`/api/favorites/${favoriteId}`, { method: "DELETE" }); if (response.ok) router.refresh(); setBusy(false); } return <button disabled={busy} onClick={remove} aria-label="Remove from favorites" title="Remove from favorites" className="shrink-0 rounded-md border border-border px-3 py-2 text-xs font-medium text-slate-600 hover:border-red-300 hover:text-red-700 disabled:opacity-60">{busy ? "Removing..." : "Remove"}</button>; }
