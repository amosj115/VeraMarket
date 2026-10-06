"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export function FollowButton({ kind, id, label }: { kind: "seller" | "shop"; id: string; label?: string }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = kind === "seller" ? `/api/sellers/${id}/follow` : `/api/shops/${id}/follow`;

  useEffect(() => {
    if (!session) return;
    fetch(endpoint).then((response) => response.json()).then((data) => setFollowing(Boolean(data.following))).catch(() => {});
  }, [session, endpoint]);

  if (session?.user?.id === id) return null;

  async function toggle() {
    if (!session) return router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
    setBusy(true);
    setError(null);
    const response = await fetch(endpoint, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setFollowing(data.following);
    else setError(data.error ?? "Could not update follow.");
    setBusy(false);
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={toggle} disabled={busy} aria-pressed={following} className={`rounded-md border px-3.5 py-1.5 text-sm font-semibold disabled:opacity-60 ${following ? "border-border bg-slate-100 text-slate-700" : "border-brand text-brand hover:bg-brand-light"}`}>
        {following ? "Following" : label ?? "Follow"}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
