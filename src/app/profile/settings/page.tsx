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
  return <div className="mx-auto max-w-xl px-4 py-10 sm:px-6"><h1 className="text-3xl font-semibold tracking-tight">Profile settings</h1><p className="mt-2 text-sm text-slate-500">Keep your public profile accurate and useful.</p><form onSubmit={submit} className="mt-8 space-y-5"><Field label="Display name" value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} /><label className="block text-sm font-medium">Bio<textarea rows={4} value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} className="mt-1 w-full rounded-md border border-border p-3 text-sm outline-none focus:border-brand" /></label><Field label="Location" value={form.location} onChange={(value) => setForm({ ...form, location: value })} /><button disabled={busy} className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Saving..." : "Save changes"}</button>{status && <p className="text-sm text-slate-600">{status}</p>}</form></div>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-sm font-medium">{label}<input required value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-border p-2.5 text-sm outline-none focus:border-brand" /></label>; }
