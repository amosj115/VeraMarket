"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NOTIFICATIONS_CHANGED, NotificationItem, announceNotificationsChanged, type NotificationDto } from "./notification-item";

type Filter = "all" | "unread";

export function NotificationCenter() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: Filter, after?: string | null) => {
    const params = new URLSearchParams({ filter: mode, limit: "20" });
    if (after) params.set("cursor", after);
    const response = await fetch(`/api/notifications?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load notifications.");
    return response.json() as Promise<{ items: NotificationDto[]; nextCursor: string | null; unreadCount: number }>;
  }, []);

  const refresh = useCallback(async (mode: Filter) => {
    try {
      const data = await load(mode);
      setItems(data.items);
      setCursor(data.nextCursor);
      setUnread(data.unreadCount);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    const initial = window.setTimeout(() => refresh(filter), 0);
    return () => window.clearTimeout(initial);
  }, [filter, refresh]);

  // Pick up new notifications without a manual refresh.
  useEffect(() => {
    const poll = () => { if (document.visibilityState === "visible") refresh(filter); };
    const timer = window.setInterval(poll, 30000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [filter, refresh]);

  useEffect(() => {
    const onChange = () => refresh(filter);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChange);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, onChange);
  }, [filter, refresh]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await load(filter, cursor);
      setItems((current) => [...current, ...data.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function open(notification: NotificationDto) {
    if (!notification.isRead) {
      setItems((current) => current.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)));
      setUnread((count) => Math.max(0, count - 1));
      await fetch(`/api/notifications/${notification.id}`, { method: "PATCH" }).catch(() => {});
      announceNotificationsChanged();
    }
    if (notification.link) router.push(notification.link);
  }

  async function remove(notification: NotificationDto) {
    setItems((current) => current.filter((item) => item.id !== notification.id));
    if (!notification.isRead) setUnread((count) => Math.max(0, count - 1));
    await fetch(`/api/notifications/${notification.id}`, { method: "DELETE" }).catch(() => {});
    announceNotificationsChanged();
  }

  async function markAllRead() {
    setItems((current) => (filter === "unread" ? [] : current.map((item) => ({ ...item, isRead: true }))));
    setUnread(0);
    await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
    announceNotificationsChanged();
  }

  return (
    <div className="mx-auto max-w-2xl px-0 pb-10 sm:px-6 sm:pt-8">
      <div className="flex items-center justify-between px-4 pt-5 sm:px-0 sm:pt-0">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <button type="button" onClick={markAllRead} disabled={unread === 0} className="text-sm font-semibold text-brand disabled:text-slate-300">
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
            onClick={() => { if (tab !== filter) { setLoading(true); setFilter(tab); } }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${filter === tab ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {tab === "all" ? "All" : `Unread${unread ? ` (${unread})` : ""}`}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-hidden border-y border-border bg-white sm:rounded-xl sm:border">
        {loading ? (
          <p className="px-6 py-16 text-center text-sm text-slate-500">Loading...</p>
        ) : error ? (
          <p className="px-6 py-16 text-center text-sm text-red-700">{error}</p>
        ) : items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-base font-semibold text-foreground">{filter === "unread" ? "No unread notifications" : "You\u2019re all caught up"}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">You&apos;ll see updates from sellers you follow and new listings that match your interests here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}><NotificationItem notification={item} onOpen={open} onDelete={remove} /></li>
            ))}
          </ul>
        )}
      </div>

      {cursor && !loading && (
        <div className="mt-4 text-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-light disabled:opacity-60">
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
