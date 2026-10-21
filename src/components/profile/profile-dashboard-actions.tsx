import Link from "next/link";

const dashboardActions = [
  { label: "Manage Listings", href: "/profile/listings", icon: "listings" },
  { label: "Favorites", href: "/profile/favorites", icon: "favorites" },
  { label: "Saved Listings", href: "/profile/saved", icon: "saved" },
  { label: "Liked Listings", href: "/profile/liked", icon: "liked" },
  { label: "Manage Shops", href: "/profile/shops", icon: "shops" },
  { label: "Manage Services", href: "/profile/services", icon: "services" },
  { label: "Manage Properties", href: "/profile/properties", icon: "properties" },
  { label: "Boost", href: "/profile/boosts", icon: "boost" },
  { label: "Seller Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Saved Searches", href: "/profile/searches", icon: "search" },
  { label: "Vera Pro", href: "/pro", icon: "pro" },
  { label: "Messages", href: "/messages", icon: "messages" },
] as const;

type DashboardIconName = (typeof dashboardActions)[number]["icon"];

const dashboardIconPaths: Record<DashboardIconName, string> = {
  listings: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  favorites: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z",
  saved: "M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-4-6 4V4.75Z",
  liked: "M7 10v10H4V10h3Zm3 0 3.2-6.4a2 2 0 0 1 1.8 2.9L13.5 10h4.2a2 2 0 0 1 2 2.4l-1.4 6A2 2 0 0 1 16.4 20H10V10Z",
  shops: "M3 10 4.5 4h15L21 10M4 10v10h16V10M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M10 20v-6h4v6",
  services: "M14.7 6.3a4.5 4.5 0 0 0-5.9 5.9L3.5 17.5a2.1 2.1 0 0 0 3 3l5.3-5.3a4.5 4.5 0 0 0 5.9-5.9l-2.8 2.8-3-3 2.8-2.8Z",
  properties: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7",
  boost: "M12 19V5m-7 7 7-7 7 7",
  dashboard: "M4 19V5m0 14h17M8 15v-3m5 3V8m5 7V5",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm6-2 4 4",
  pro: "m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z",
  messages: "M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2v-5.5A7.5 7.5 0 1 1 20 11.5ZM8 11h.01M12 11h.01M16 11h.01",
};

export function ProfileDashboardActions() {
  return (
    <nav aria-label="Profile dashboard" className="mt-6">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
        {dashboardActions.map(({ label, href, icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex min-h-[68px] min-w-0 items-center gap-2.5 rounded-xl border border-border bg-white px-3 py-3 text-slate-700 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-md active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-brand transition-colors group-hover:bg-blue-100">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={dashboardIconPaths[icon]} />
              </svg>
            </span>
            <span className="min-w-0 break-words text-[13px] font-semibold leading-snug text-slate-800">
              {label}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
