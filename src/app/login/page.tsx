"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  function callbackDestination() {
    const requestedCallback = new URLSearchParams(window.location.search).get("callbackUrl");
    return requestedCallback?.startsWith("/") && !requestedCallback.startsWith("//")
      ? requestedCallback
      : "/";
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        callbackUrl: callbackDestination(),
        redirect: false,
      });

      if (!result?.ok || result.error) {
        setError("Incorrect email or password.");
        setLoading(false);
        return;
      }

      router.replace(callbackDestination());
      router.refresh();
    } catch {
      setError("Login is temporarily unavailable. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-500">Log in to Vera Market.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </label>

        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={loading || !ready}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        New to Vera Market?{" "}
        <Link href="/register" className="font-medium text-brand">
          Create an account
        </Link>
      </p>
    </div>
  );
}
