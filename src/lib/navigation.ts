export const PRIMARY_NAV = [
  { label: "Marketplace", href: "/marketplace" },
  { label: "Trending", href: "/trending" },
  { label: "Virtual Shop", href: "/shops" },
  { label: "Services", href: "/services" },
  { label: "Real Estate", href: "/real-estate" },
] as const;

export const ACCOUNT_NAV = [
  { label: "Messages", href: "/messages" },
  { label: "Profile", href: "/profile" },
] as const;

export const MOBILE_NAV = [
  { label: "Home", href: "/", icon: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" },
  { label: "Marketplace", href: "/marketplace", icon: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" },
  { label: "Virtual Shop", href: "/shops", icon: "M3 9l1-5h16l1 5M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8" },
  { label: "Services", href: "/services", icon: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-.7-.7-2.2z" },
  { label: "Real Estate", href: "/real-estate", icon: "M4 21V8l8-5 8 5v13M9 21v-6h6v6" },
] as const;
