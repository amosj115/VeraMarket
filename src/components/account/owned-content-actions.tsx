"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ContentType = "services" | "properties";
export function OwnedContentActions({ type, id }: { type: ContentType; id: string }) { const router = useRouter(); const [busy, setBusy] = useState(false); async function remove() { if (!window.confirm("Remove this item from public Vera Market pages?")) return; setBusy(true); const response = await fetch(`/api/${type}/${id}`, { method: "DELETE" }); if (response.ok) router.refresh(); setBusy(false); } return <button disabled={busy} onClick={remove} className="rounded-md border border-border px-3 py-2 text-xs font-medium text-red-700 hover:border-red-300 disabled:opacity-60">{busy ? "Removing..." : "Remove"}</button>; }
