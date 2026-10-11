"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ProfileSettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState({ displayName: "", bio: "", location: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => { fetch("/api/profile").then((response) => response.json()).then((data) => { if (data.user) setForm({ displayName: data.user.displayName, bio: data.user.bio ?? "", location: data.user.location ?? "" }); setBusy(false); }); }, []);
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setStatus(null); const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); const data = await response.json(); setStatus(response.ok ? "Profile updated." : data.error ?? "Could not update profile."); setBusy(false); if (response.ok) router.refresh(); }
  return <div className="mx-auto max-w-xl px-4 py-10 sm:px-6"><h1 className="text-3xl font-semibold tracking-tight">Profile settings</h1><p className="mt-2 text-sm text-slate-500">Keep your public profile accurate and useful.</p><form onSubmit={submit} className="mt-8 space-y-5"><Field label="Display name" value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} /><label className="block text-sm font-medium">Bio<textarea rows={4} value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} className="mt-1 w-full rounded-md border border-border p-3 text-sm outline-none focus:border-brand" /></label><Field label="Location" value={form.location} onChange={(value) => setForm({ ...form, location: value })} /><button disabled={busy} className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Saving..." : "Save changes"}</button>{status && <p className="text-sm text-slate-600">{status}</p>}</form><DangerZone /></div>;
}

function DangerZone() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Could not delete your account."); return; }
    router.push("/profile?deleted=1");
  }

  return (
    <section className="mt-12 rounded-lg border border-red-200 bg-red-50/40 p-5">
      <h2 className="text-sm font-semibold text-red-800">Delete my account</h2>
      <p className="mt-1 text-sm text-slate-600">This permanently deactivates your account and removes your personal information. Your listings and store are taken down. Some records are kept for security and legal reasons.</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-4 rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100">Delete my account</button>
      ) : (
        <form onSubmit={confirmDelete} className="mt-4 space-y-3">
          <p className="text-sm text-slate-700">This cannot be undone. You will lose access immediately.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Your profile, listings, store and personal details are removed from public view.</li>
            <li>Messages, offers, reports and payment records are kept where another person or the law requires them, shown as &quot;Deleted account&quot;.</li>
          </ul>
          <label className="block text-sm font-medium">Confirm your password
            <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-md border border-border p-2.5 text-sm outline-none focus:border-brand" />
          </label>
          {error && <p className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button disabled={busy} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">{busy ? "Deleting..." : "Permanently delete"}</button>
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setPassword(""); setError(null); }} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-sm font-medium">{label}<input required value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-border p-2.5 text-sm outline-none focus:border-brand" /></label>; }
