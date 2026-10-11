"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { NotificationSummary } from "@/lib/notification-groups";
import { ChatGroupRow, SystemGroupRow } from "./notification-groups";
import { NOTIFICATIONS_CHANGED, announceNotificationsChanged } from "./notification-item";

const BELL_PATH = "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0";
const PREVIEW_CHATS = 4;

// Shared unread-count store. The header renders this bell twice (desktop and
// mobile; CSS shows only one), so per-instance polling would double every
// request on every page. One module-level poller serves all subscribers via
// useSyncExternalStore.
let sharedUnread = 0;
const unreadListeners = new Set<() => void>();
let pollTimer: number | null = null;

function emitUnread() {
  for (const listener of unreadListeners) listener();
}

async function fetchUnreadCount() {
  try {
    const response = await fetch("/api/notifications/unread-count", { cache: "no-store" });
    if (response.ok) {
      sharedUnread = (await response.json()).count ?? 0;
      emitUnread();
    }
  } catch {}
}

function handleVisibility() {
  if (document.visibilityState === "visible") void fetchUnreadCount();
}

function startUnreadPolling() {
  if (pollTimer !== null) return;
  void fetchUnreadCount();
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void fetchUnreadCount();
  }, 30000);
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener(NOTIFICATIONS_CHANGED, fetchUnreadCount);
}

function stopUnreadPolling() {
  if (pollTimer === null) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener("visibilitychange", handleVisibility);
  window.removeEventListener(NOTIFICATIONS_CHANGED, fetchUnreadCount);
}

// Keep the shared badge in sync immediately after local state changes (e.g. mark-all-read).
function publishUnread(count: number) {
  sharedUnread = count;
  emitUnread();
}

function subscribeUnread(callback: () => void) {
  unreadListeners.add(callback);
  startUnreadPolling();
  return () => {
    unreadListeners.delete(callback);
    if (!unreadListeners.size) stopUnreadPolling();
  };
}

function getUnreadSnapshot() {
  return sharedUnread;
}

function subscribeNothing() {
  return () => {};
}

export function NotificationBell({ className = "" }: { className?: string }) {
  const { status } = useSession();
  const router = useRouter();
  const authenticated = status === "authenticated";
  // Logged-out visitors render the bell as a login link and must not start the poller.
  const storeUnread = useSyncExternalStore(authenticated ? subscribeUnread : subscribeNothing, getUnreadSnapshot, getUnreadSnapshot);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const unread = authenticated ? storeUnread : 0;

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/notifications/summary", { cache: "no-store" });
      if (response.ok) {
        const data = (await response.json()) as NotificationSummary;
        setSummary(data);
        publishUnread(data.totalUnread);
      }
    } finally {
      setLoading(false);
    }
  }, []);

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

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
      await refreshList();
      announceNotificationsChanged();
    } finally {
      setMarkingAll(false);
    }
  }

  const icon = (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={BELL_PATH} /></svg>
  );
  const buttonClass = `relative flex h-9 w-9 items-center justify-center rounded-full text-slate-700 hover:bg-brand-light hover:text-brand ${className}`;

  if (!authenticated) {
    return <Link href="/login?callbackUrl=/notifications" aria-label="Notifications" className={buttonClass}>{icon}</Link>;
  }

  const chatGroups = summary?.chatGroups.slice(0, PREVIEW_CHATS) ?? [];
  const system = summary?.system ?? null;
  const hasRows = Boolean((summary && chatGroups.length > 0) || system);
  const closeAndNavigate = () => setOpen(false);

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
            <button type="button" onClick={markAllRead} disabled={markingAll || unread === 0} className="text-xs font-semibold text-brand disabled:text-slate-300">Mark all as read</button>
          </div>
          <div className="max-h-[28rem] overflow-y-auto divide-y divide-border">
            {loading && !summary ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">Loading...</p>
            ) : !hasRows ? (
              <div className="px-6 py-10 text-center">
                <p className="text-sm font-semibold">You&apos;re all caught up</p>
                <p className="mt-1 text-xs text-slate-500">Messages from other members and updates from Vera Market will appear here.</p>
              </div>
            ) : (
              <>
                {chatGroups.length > 0 && (
                  <>
                    <p className="bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Messages</p>
                    <ul className="divide-y divide-border">
                      {chatGroups.map((group) => (
                        <li key={group.conversationId}><ChatGroupRow group={group} onNavigate={closeAndNavigate} /></li>
                      ))}
                    </ul>
                  </>
                )}
                {system && (
                  <>
                    <p className="bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Updates</p>
                    <ul className="divide-y divide-border">
                      <li><SystemGroupRow system={system} onNavigate={closeAndNavigate} /></li>
                    </ul>
                  </>
                )}
              </>
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
