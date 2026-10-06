"use client";

import { useSyncExternalStore } from "react";

function greetingFor(hour: number) {
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

const subscribe = () => () => {};

export function Greeting() {
  const text = useSyncExternalStore(
    subscribe,
    () => greetingFor(new Date().getHours()),
    () => "Hello"
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{text},</h1>
      <p className="mt-1 text-sm text-white/85 sm:text-base">Let&apos;s find what you&apos;re looking for today.</p>
    </div>
  );
}
