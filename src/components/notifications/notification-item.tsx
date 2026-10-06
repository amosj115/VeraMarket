"use client";

export type NotificationDto = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  imageUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

export const NOTIFICATIONS_CHANGED = "notifications:changed";

export function announceNotificationsChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

const ICONS: Record<string, string> = {
  user: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8M7 7h.01",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z",
  shop: "M3 9l1-5h16l1 5M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8",
  tool: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-.7-.7-2.2z",
  home: "M4 21V8l8-5 8 5v13M9 21v-6h6v6",
  message: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
};

function iconFor(type: string) {
  switch (type) {
    case "FOLLOWED_SELLER_LISTING": return ICONS.user;
    case "SEARCH_MATCH":
    case "TRENDING_MATCH": return ICONS.search;
    case "PRICE_CHANGE":
    case "LISTING_UPDATE":
    case "LISTING_APPROVED":
    case "LISTING_REJECTED": return ICONS.tag;
    case "FAVOURITE_UPDATE":
    case "LISTING_FAVORITED": return ICONS.heart;
    case "SHOP_UPDATE":
    case "STORE_FOLLOWED":
    case "STORE_PRODUCT_ADDED":
    case "STORE_UPDATE":
    case "STORE_SUBSCRIPTION_ACTIVE": return ICONS.shop;
    case "SERVICE_UPDATE": return ICONS.tool;
    case "REAL_ESTATE_UPDATE": return ICONS.home;
    case "MESSAGE":
    case "NEW_MESSAGE": return ICONS.message;
    case "ACCOUNT":
    case "ACCOUNT_SECURITY":
    case "VERIFICATION_UPDATE": return ICONS.shield;
    default: return ICONS.bell;
  }
}

export function relativeTime(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export function NotificationItem({ notification, onOpen, onDelete }: { notification: NotificationDto; onOpen: (notification: NotificationDto) => void; onDelete?: (notification: NotificationDto) => void }) {
  return (
    <div className={`group relative flex items-start gap-3 px-4 py-3 ${notification.isRead ? "bg-white" : "bg-brand-light/60"}`}>
      <button type="button" onClick={() => onOpen(notification)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        {notification.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={notification.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-slate-100 object-cover" />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={iconFor(notification.type)} />
            </svg>
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${notification.isRead ? "font-medium text-foreground" : "font-semibold text-foreground"}`}>{notification.title}</span>
          <span className="mt-0.5 line-clamp-2 block text-sm text-slate-600">{notification.body}</span>
          <span className="mt-1 block text-xs text-slate-400">{relativeTime(notification.createdAt)}</span>
        </span>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {!notification.isRead && <span className="mt-1 h-2.5 w-2.5 rounded-full bg-brand" aria-label="Unread" />}
        {onDelete && (
          <button type="button" onClick={() => onDelete(notification)} aria-label="Delete notification" className="rounded p-1 text-slate-300 hover:text-red-600 focus:text-red-600">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
