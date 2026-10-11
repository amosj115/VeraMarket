"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MOBILE_NAV } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const INDICATOR_INSET = 4;

export function MobileNav() {
  const pathname = usePathname();
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const glassRef = useRef<HTMLSpanElement | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Track viewport so we skip measuring work on desktop (nav is md:hidden).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Measure the active item and drive the glass surface imperatively.
  // Doing this in the DOM (not state) avoids cascading renders and lets us
  // both position and fade the glass without an extra render pass.
  useLayoutEffect(() => {
    const glass = glassRef.current;
    if (!glass) return;

    if (!isMobile) {
      glass.style.opacity = "0";
      return;
    }

    const container = listRef.current;
    const item = itemRefs.current[MOBILE_NAV.findIndex((i) =>
      i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)
    )];

    if (!container || !item) {
      glass.style.opacity = "0";
      return;
    }

    const cRect = container.getBoundingClientRect();
    const iRect = item.getBoundingClientRect();
    const left = iRect.left - cRect.left + INDICATOR_INSET;
    const width = Math.max(iRect.width - INDICATOR_INSET * 2, 0);

    glass.style.transform = `translateX(${left}px)`;
    glass.style.width = `${width}px`;
    glass.style.opacity = "1";

    // On the very first real measurement, snap to position instantly (no slide
    // from 0) so the glass appears in place; later moves glide via transition.
    if (glass.dataset.ready !== "true") {
      glass.dataset.ready = "true";
      glass.style.transition = "none";
      void glass.offsetWidth; // reflow: apply position before re-enabling transition
      glass.style.transition = "";
    }
  }, [pathname, isMobile]);

  // Respect reduced-motion for the sliding transition.
  useEffect(() => {
    const glass = glassRef.current;
    if (!glass) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    function apply() {
      glass!.style.transitionDuration = mq.matches ? "0ms" : "";
    }
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Keep the glass aligned if the viewport is resized.
  useEffect(() => {
    if (!isMobile) return;
    function onResize() {
      const glass = glassRef.current;
      const container = listRef.current;
      if (!glass || !container) return;
      const item = itemRefs.current[MOBILE_NAV.findIndex((i) =>
        i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)
      )];
      if (!item) {
        glass.style.opacity = "0";
        return;
      }
      const cRect = container.getBoundingClientRect();
      const iRect = item.getBoundingClientRect();
      glass.style.transform = `translateX(${iRect.left - cRect.left + INDICATOR_INSET}px)`;
      glass.style.width = `${Math.max(iRect.width - INDICATOR_INSET * 2, 0)}px`;
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pathname, isMobile]);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 backdrop-blur md:hidden">
      <div ref={listRef} className="relative grid grid-cols-5">
        {/* Liquid-glass surface — a single element that glides between items. */}
        <span
          ref={glassRef}
          data-nav-glass
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-1 left-0 z-0 rounded-2xl",
            // Frosted body + backdrop blur (graceful fallback: flat translucent tint).
            "bg-white/30 backdrop-blur-md",
            // Crisp glass rim catching light from above.
            "ring-1 ring-inset ring-white/50",
            // Depth: a soft outer refracted glow + a faint inner bottom shadow.
            "shadow-[0_2px_8px_-2px_rgba(29,78,216,0.15),inset_0_-1px_2px_rgba(29,78,216,0.06)]",
            // Smooth glide + width morph.
            "transition-[transform,width,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "motion-reduce:transition-none motion-reduce:duration-0"
          )}
          style={{ opacity: 0, width: 0 }}
        >
          {/* Subtle blue brand tint, stronger at the top for glass thickness. */}
          <span className="absolute inset-0 rounded-2xl bg-[linear-gradient(180deg,rgba(29,78,216,0.08)_0%,rgba(29,78,216,0.03)_100%)]" />
          {/* Crisp specular top-edge highlight. */}
          <span className="absolute inset-x-3 top-0 h-px bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.9)_50%,transparent_100%)]" />
          {/* Soft internal reflection / sheen sweeping the upper glass. */}
          <span className="absolute inset-0 rounded-2xl bg-[radial-gradient(110%_70%_at_25%_-10%,rgba(255,255,255,0.7)_0%,rgba(255,255,255,0)_55%)]" />
        </span>

        {MOBILE_NAV.map((item, index) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative z-10 flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium text-slate-500 transition-colors duration-300 ease-out",
                active && "text-brand"
              )}
            >
              <svg
                viewBox="0 0 24 24"
                className={cn(
                  "h-5 w-5 fill-none stroke-current transition-transform duration-300 ease-out motion-reduce:transition-none",
                  active && "scale-[1.06]"
                )}
                strokeWidth={active ? 2.2 : 1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
