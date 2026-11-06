"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches the server-rendered status while a payment is still pending. It only refreshes; it never marks anything paid. */
export function PaymentStatusRefresher({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(id);
  }, [active, router]);
  return null;
}
