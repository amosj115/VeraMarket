"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotificationSummary } from "@/lib/notification-groups";
import { ChatGroupRow, SystemGroupRow } from "./notification-groups";
import { NOTIFICATIONS_CHANGED, announceNotificationsChanged } from "./notification-item";

type Filter = "all" | "unread";

export function NotificationCenter() {
  const [filter, setFilter] = useState<Filter>("all");
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/summary", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load notifications.");
      setSummary(await response.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  // Pick up new messages and updates without a manual refresh.
  useEffect(() => {
    const poll = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(poll, 30000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [refresh]);

  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
  }, [refresh]);

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
      await refresh();
      announceNotificationsChanged();
    } finally {
      setMarkingAll(false);
    }
  }

  const chatGroups = summary?.chatGroups ?? [];
  const system = summary?.system ?? null;
  const totalUnread = summary?.totalUnread ?? 0;
  const showSystem = Boolean(system && (filter === "all" || system.count > 0));
  const hasRows = chatGroups.length > 0 || showSystem;

  const sectionLabel = (text: string) => (
    <p className="bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{text}</p>
  );

  return (
    <div className="mx-auto max-w-2xl px-0 pb-10 sm:px-6 sm:pt-8">
      <div className="flex items-center justify-between px-4 pt-5 sm:px-0 sm:pt-0">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <button type="button" onClick={markAllRead} disabled={markingAll || totalUnread === 0} className="text-sm font-semibold text-brand disabled:text-slate-300">
          Mark all as read
        </button>
      </div>

      <div className="mt-4 flex gap-2 px-4 sm:px-0" role="tablist" aria-label="Notification filter">
        {(["all", "unread"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={filter === tab}
            onClick={() => setFilter(tab)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${filter === tab ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {tab === "all" ? "All" : `Unread${totalUnread ? ` (${totalUnread})` : ""}`}
          </button>
        ))}
      </div>

      <div className="mt-4 divide-y divide-border overflow-hidden border-y border-border bg-white sm:rounded-xl sm:border">
        {loading ? (
          <p className="px-6 py-16 text-center text-sm text-slate-500">Loading...</p>
        ) : error ? (
          <p className="px-6 py-16 text-center text-sm text-red-700">{error}</p>
        ) : !hasRows ? (
          <div className="px-6 py-16 text-center">
            <p className="text-base font-semibold text-foreground">{filter === "unread" ? "No unread notifications" : "You\u2019re all caught up"}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
              {filter === "unread" ? "New messages and updates will appear here." : "Messages from other members and updates from Vera Market will appear here."}
            </p>
          </div>
        ) : (
          <>
            {chatGroups.length > 0 && (
              <>
                {sectionLabel("Messages")}
                <ul className="divide-y divide-border">
                  {chatGroups.map((group) => (
                    <li key={group.conversationId}><ChatGroupRow group={group} /></li>
                  ))}
                </ul>
              </>
            )}
            {showSystem && system && (
              <>
                {sectionLabel("Updates")}
                <ul className="divide-y divide-border">
                  <li><SystemGroupRow system={system} /></li>
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {!loading && !error && (
        <div className="mt-4 px-4 sm:px-0">
          <a href="/notifications/system" className="block rounded-md border border-border px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-brand-light">
            See all Vera Market updates
          </a>
        </div>
      )}
    </div>
  );
}
