"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [requestingCode, setRequestingCode] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Keep the submit button inert until hydration so an early click cannot do a native form submit (page reload).
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function callbackDestination() {
    const requestedCallback = new URLSearchParams(window.location.search).get(
      "callbackUrl"
    );
    return requestedCallback?.startsWith("/") && !requestedCallback.startsWith("//")
      ? requestedCallback
      : "/";
  }

  async function completeLogin(code?: string) {
    try {
      const result = await signIn("credentials", {
        email,
        password,
        verificationCode: code ?? "",
        callbackUrl: callbackDestination(),
        redirect: false,
      });

      if (!result?.ok || result.error) {
        setError(
          code
            ? "That verification code is incorrect or expired. Check the code or request another."
            : "Incorrect email or password."
        );
        setLoading(false);
        return;
      }
    } catch {
      setError("Login is temporarily unavailable. Please try again.");
      setLoading(false);
      return;
    }

    router.replace(callbackDestination());
    router.refresh();
  }

  async function requestCode() {
    if (loading) return;
    setError(null);
    setStatusMessage(null);
    setLoading(true);
    setRequestingCode(true);

    try {
      const response = await fetch("/api/auth/phone-verification/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        requiresVerification?: boolean;
        destination?: string;
        retryAfterSeconds?: number;
      } | null;

      if (!response.ok) {
        if (typeof result?.retryAfterSeconds === "number") {
          setCooldown(result.retryAfterSeconds);
        }
        if (response.status === 502) {
          setCodeSent(false);
          setVerificationCode("");
        }
        setError(result?.error ?? "Could not request a verification code. Please try again.");
        setLoading(false);
        setRequestingCode(false);
        return;
      }

      if (!result?.requiresVerification) {
        setStatusMessage("This account has no verified phone number. Continuing with password login.");
        setRequestingCode(false);
        await completeLogin();
        return;
      }

      setCodeSent(true);
      setVerificationCode("");
      setCooldown(result.retryAfterSeconds ?? 60);
      setStatusMessage(
        `A code was sent by SMS${result.destination ? ` to ${result.destination}` : ""}.`
      );
      setLoading(false);
      setRequestingCode(false);
    } catch {
      setError("Could not request a verification code. Please try again.");
      setLoading(false);
      setRequestingCode(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!codeSent && cooldown > 0) return;
    if (codeSent && !/^\d{6}$/.test(verificationCode)) {
      setError("Enter the six-digit verification code.");
      return;
    }
    setError(null);
    setStatusMessage(null);
    if (codeSent) {
      setLoading(true);
      await completeLogin(verificationCode);
    } else {
      await requestCode();
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
            onChange={(e) => setEmail(e.target.value)}
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
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </label>

        <fieldset className="rounded-lg border border-border bg-blue-50/50 px-3 py-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Phone verification</legend>
          <p className="text-sm font-semibold text-slate-900">SMS</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Receive your six-digit verification code by text message.
          </p>
        </fieldset>
        <p className="text-xs leading-relaxed text-slate-500">
          Codes are sent by SMS only to the verified phone number on your account.
        </p>

        {codeSent && (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Verification code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-center text-lg tracking-[0.35em] text-foreground shadow-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
          </label>
        )}

        {statusMessage && (
          <p role="status" className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
            {statusMessage}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !ready || (!codeSent && cooldown > 0)}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
        >
          {loading && (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 animate-spin">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {loading
            ? requestingCode
              ? "Sending code…"
              : codeSent
              ? "Verifying…"
              : "Logging in…"
            : codeSent
              ? "Verify & log in"
              : cooldown > 0
                ? `Request another code in ${cooldown}s`
                : "Continue with SMS"}
        </button>
        {codeSent && (
          <button
            type="button"
            disabled={loading || cooldown > 0}
            onClick={requestCode}
            className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {cooldown > 0
              ? `Send a new code in ${cooldown}s`
                : "Send a new code by SMS"}
          </button>
        )}
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
