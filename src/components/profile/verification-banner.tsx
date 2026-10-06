"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

export function VerificationBanner() {
  const { status } = useSession();
  const pathname = usePathname();
  const [needsVerification, setNeedsVerification] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/profile/verification", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled && data) setNeedsVerification(data.enforced && data.status !== "VERIFIED"); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [status, pathname]);

  if (status !== "authenticated" || !needsVerification || pathname.startsWith("/onboarding")) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6 lg:px-8">
        <p className="text-amber-900"><span className="font-semibold">Profile verification required.</span> Verify that you&apos;re really you to buy, sell, message and open a Virtual Store.</p>
        <Link href="/onboarding/profile" className="font-semibold text-amber-900 underline">Verify now</Link>
      </div>
    </div>
  );
}
