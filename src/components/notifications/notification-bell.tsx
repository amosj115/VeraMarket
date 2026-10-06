"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { NOTIFICATIONS_CHANGED, NotificationItem, announceNotificationsChanged, type NotificationDto } from "./notification-item";

const BELL_PATH = "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0";

export function NotificationBell({ className = "" }: { className?: string }) {
  const { status } = useSession();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const authenticated = status === "authenticated";

  const refreshCount = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/unread-count", { cache: "no-store" });
      if (response.ok) setUnread((await response.json()).count ?? 0);
    } catch {}
  }, []);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/notifications?limit=8", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setItems(data.items);
        setUnread(data.unreadCount);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const initial = window.setTimeout(refreshCount, 0);
    const poll = () => { if (document.visibilityState === "visible") refreshCount(); };
    const timer = window.setInterval(poll, 30000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener(NOTIFICATIONS_CHANGED, refreshCount);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refreshCount);
    };
  }, [authenticated, refreshCount]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function toggle() {
    // Small screens get the full-page Notification Center instead of a dropdown.
    if (!window.matchMedia("(min-width: 768px)").matches) return router.push("/notifications");
    const next = !open;
    setOpen(next);
    if (next) refreshList();
  }

  async function openItem(notification: NotificationDto) {
    setOpen(false);
    if (!notification.isRead) {
      setItems((current) => current.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)));
      setUnread((count) => Math.max(0, count - 1));
      await fetch(`/api/notifications/${notification.id}`, { method: "PATCH" }).catch(() => {});
      announceNotificationsChanged();
    }
    router.push(notification.link ?? "/notifications");
  }

  async function markAllRead() {
    setItems((current) => current.map((item) => ({ ...item, isRead: true })));
    setUnread(0);
    await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
    announceNotificationsChanged();
  }

  const icon = (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={BELL_PATH} /></svg>
  );
  const buttonClass = `relative flex h-9 w-9 items-center justify-center rounded-full text-slate-700 hover:bg-brand-light hover:text-brand ${className}`;

  if (!authenticated) {
    return <Link href="/login?callbackUrl=/notifications" aria-label="Notifications" className={buttonClass}>{icon}</Link>;
  }

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={toggle} aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} aria-haspopup="true" aria-expanded={open} className={buttonClass}>
        {icon}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 hidden w-[24rem] overflow-hidden rounded-xl border border-border bg-white shadow-xl md:block">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button type="button" onClick={markAllRead} disabled={unread === 0} className="text-xs font-semibold text-brand disabled:text-slate-300">Mark all as read</button>
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">Loading...</p>
            ) : items.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-sm font-semibold">You&apos;re all caught up</p>
                <p className="mt-1 text-xs text-slate-500">Updates from sellers you follow and listings that match your interests will appear here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => <li key={item.id}><NotificationItem notification={item} onOpen={openItem} /></li>)}
              </ul>
            )}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-4 py-3 text-center text-sm font-semibold text-brand hover:bg-brand-light">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
