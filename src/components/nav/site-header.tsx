"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";
import { PRIMARY_NAV } from "@/lib/navigation";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
            V
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-tight text-foreground">Vera Market</span>
            <span className="text-[11px] text-slate-500">Buy real, sell safe</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-light hover:text-brand",
                pathname.startsWith(item.href) && "bg-brand-light text-brand"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {status === "authenticated" ? (
            <>
              <Link
                href="/messages"
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-light hover:text-brand"
              >
                Messages
              </Link>
              <NotificationBell />
              {session.user?.role !== "USER" && <><Link href="/admin/moderation" className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-light hover:text-brand">Admin</Link><Link href="/admin/config" className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-light hover:text-brand">Config</Link><Link href="/admin/trending" className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-light hover:text-brand">Analytics</Link></>}
              <Link
                href="/sell"
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
              >
                Sell something
              </Link>
              <Link
                href="/profile"
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-light hover:text-brand"
              >
                {session.user?.username ?? "Profile"}
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-light hover:text-brand"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
              >
                Join Vera Market
              </Link>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <NotificationBell />
          <Link href={status === "authenticated" ? "/profile" : "/login"} aria-label="Profile" className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-semibold uppercase text-white">
            {session?.user?.username?.[0] ?? "?"}
          </Link>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          <span className="sr-only">Menu</span>
          <div className="space-y-1">
            <span className="block h-0.5 w-5 bg-slate-700" />
            <span className="block h-0.5 w-5 bg-slate-700" />
            <span className="block h-0.5 w-5 bg-slate-700" />
          </div>
        </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-border bg-white px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-light"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="my-2 h-px bg-border" />
            {status === "authenticated" ? (
              <>
                <Link
                  href="/sell"
                  className="rounded-md bg-brand px-3 py-2 text-center text-sm font-semibold text-white"
                  onClick={() => setMenuOpen(false)}
                >
                  Sell something
                </Link>
                <Link
                  href="/messages"
                  className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-light"
                  onClick={() => setMenuOpen(false)}
                >
                  Messages
                </Link>
                {session.user?.role !== "USER" && <><Link href="/admin/moderation" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-light">Admin moderation</Link><Link href="/admin/trending" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-light">Trending analytics</Link></>}
                <Link
                  href="/profile"
                  className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-light"
                  onClick={() => setMenuOpen(false)}
                >
                  Profile
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="rounded-md px-3 py-2 text-left text-sm font-medium text-slate-500"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-light"
                  onClick={() => setMenuOpen(false)}
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="rounded-md bg-brand px-3 py-2 text-center text-sm font-semibold text-white"
                  onClick={() => setMenuOpen(false)}
                >
                  Join Vera Market
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
