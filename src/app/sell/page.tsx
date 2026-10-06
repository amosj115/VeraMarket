"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Category = { id: string; name: string };

export default function SellPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState({ title: "", description: "", priceRand: "", categoryId: "", condition: "GOOD", location: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/categories").then((response) => response.json()).then((data) => setCategories(data.categories ?? [])); }, []);
  function update(key: string, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null); setBusy(true);
    try {
      if (!files.length) throw new Error("Add at least one photo.");
      const imageUrls: string[] = [];
      for (const file of files) { const body = new FormData(); body.append("file", file); const response = await fetch("/api/uploads", { method: "POST", body }); const data = await response.json(); if (!response.ok) throw new Error(data.error); imageUrls.push(data.url); }
      const response = await fetch("/api/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, priceRand: Number(form.priceRand), imageUrls }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); router.push("/profile/listings?submitted=1");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not publish listing."); setBusy(false); }
  }
  return <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6"><p className="text-sm font-medium text-brand">Sell something</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Create a listing</h1><p className="mt-2 text-sm text-slate-500">New listings are reviewed before they appear publicly.</p><form onSubmit={submit} className="mt-8 space-y-5"><label className="block text-sm font-medium">Photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple required onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 10))} className="mt-2 block w-full rounded-md border border-border p-2 text-sm" /><span className="mt-1 block text-xs font-normal text-slate-500">Up to 10 images, 5MB each. JPEG, PNG or WEBP.</span></label><Field label="Title" value={form.title} onChange={(value) => update("title", value)} /><label className="block text-sm font-medium">Description<textarea required minLength={10} rows={5} value={form.description} onChange={(event) => update("description", event.target.value)} className="mt-1 w-full rounded-md border border-border p-3 text-sm outline-none focus:border-brand" /></label><div className="grid gap-4 sm:grid-cols-2"><Field label="Price (ZAR)" type="number" value={form.priceRand} onChange={(value) => update("priceRand", value)} /><label className="block text-sm font-medium">Category<select required value={form.categoryId} onChange={(event) => update("categoryId", event.target.value)} className="mt-1 w-full rounded-md border border-border bg-white p-2.5 text-sm"><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Condition<select value={form.condition} onChange={(event) => update("condition", event.target.value)} className="mt-1 w-full rounded-md border border-border bg-white p-2.5 text-sm"><option value="NEW">New</option><option value="LIKE_NEW">Like new</option><option value="GOOD">Good</option><option value="FAIR">Fair</option><option value="FOR_PARTS">For parts</option></select></label><Field label="Location" value={form.location} onChange={(value) => update("location", value)} /></div>{error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<button disabled={busy} className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Submitting..." : "Submit for review"}</button></form></div>;
}
function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="block text-sm font-medium">{label}<input required type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-border p-2.5 text-sm outline-none focus:border-brand" /></label>; }
