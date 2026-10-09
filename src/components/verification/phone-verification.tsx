"use client";

import { useState } from "react";

// Normalize various South African phone number formats to E.164 (+27XXXXXXXXX)
function normalizeSaPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;

  // Already in international format with +27
  if (digits.startsWith("27") && digits.length === 11) {
    return "+" + digits;
  }
  // Local format with leading zero: 0821234567 (10 digits)
  if (digits.startsWith("0") && digits.length === 10) {
    return "+27" + digits.slice(1);
  }
  // Local format without leading zero: 821234567 (9 digits)
  if (!digits.startsWith("0") && digits.length === 9) {
    return "+27" + digits;
  }
  // With +27 already but maybe with extra digits
  if (digits.startsWith("27") && digits.length > 11) {
    return "+" + digits.slice(0, 11);
  }
  return null;
}

export function PhoneVerification({ verified }: { verified: boolean }) {
  const [localPhone, setLocalPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalizedPhone = normalizeSaPhone(localPhone);

  async function send() {
    if (!normalizedPhone) {
      setStatus("Enter a valid South African mobile number (e.g., 082 123 4567 or 821234567).");
      return;
    }
    setBusy(true);
    setStatus(null);
    const response = await fetch("/api/verification/phone/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalizedPhone }),
    });
    const data = await response.json();
    setStatus(response.ok ? "Code sent. Check your phone." : `${data.error}${data.missing ? ` Missing: ${data.missing.join(", ")}` : ""}${data.detail ? ` (${data.detail})` : ""}`);
    if (response.ok) setSent(true);
    setBusy(false);
  }

  async function check() {
    setBusy(true);
    setStatus(null);
    const response = await fetch("/api/verification/phone/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await response.json();
    setStatus(response.ok ? "Phone verified." : data.error);
    if (response.ok) window.location.reload();
    setBusy(false);
  }

  if (verified) return <p className="mt-4 text-sm font-medium text-emerald-700">Phone verified</p>;

  return (
    <div className="mt-5 space-y-3">
      <div className="flex gap-2">
        <span className="flex items-center px-3 py-2 text-sm bg-slate-100 border border-border rounded-l-md font-mono text-slate-700">+27</span>
        <input
          value={localPhone}
          onChange={(event) => setLocalPhone(event.target.value.replace(/\D/g, "").slice(0, 9))}
          placeholder="82 123 4567"
          inputMode="numeric"
          className="min-w-0 flex-1 rounded-r-md border border-border px-3 py-2 text-sm"
          aria-label="South African mobile number without +27"
          disabled={sent}
        />
        <button disabled={busy || !normalizedPhone} onClick={send} className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">Send code</button>
      </div>
      {sent && (
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="Verification code"
            className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm"
            autoComplete="one-time-code"
          />
          <button disabled={busy} onClick={check} className="rounded-md border border-brand px-3 py-2 text-xs font-semibold text-brand disabled:opacity-60">Verify</button>
        </div>
      )}
      {status && <p className="text-sm text-slate-600">{status}</p>}
    </div>
  );
}