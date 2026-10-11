"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_NAV } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 backdrop-blur md:hidden">
      <div className="grid grid-cols-5">
        {MOBILE_NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium text-slate-500 transition-colors duration-300 ease-out",
                active && "text-brand"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-x-1.5 inset-y-0.5 rounded-xl transition-all duration-300 ease-out",
                  active &&
                    "bg-gradient-to-b from-brand/15 via-brand/10 to-brand/5 shadow-[0_0_12px_rgba(29,78,216,0.15)] ring-1 ring-inset ring-brand/20"
                )}
              />
              <svg
                viewBox="0 0 24 24"
                className={cn(
                  "relative h-5 w-5 fill-none stroke-current transition-all duration-300 ease-out",
                  active && "drop-shadow-[0_0_6px_rgba(29,78,216,0.35)]"
                )}
                strokeWidth={active ? 2.2 : 1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={item.icon} />
              </svg>
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
