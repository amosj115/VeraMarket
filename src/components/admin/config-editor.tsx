"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = Record<string, string | number | boolean | undefined>;
type Field = { name: string; label: string; type: "text" | "number" | "checkbox" | "select"; options?: string[]; scale?: number };

function RowEditor({ section, fields, initial, submitLabel }: { section: string; fields: Field[]; initial: Row; submitLabel: string }) {
  const router = useRouter();
  const [row, setRow] = useState<Row>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const data: Row = { ...row };
    for (const field of fields) {
      if (field.type === "number") data[field.name] = Math.round(Number(row[field.name]) * (field.scale ?? 1));
    }
    const response = await fetch("/api/admin/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section, data }) });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage({ ok: false, text: result.error ?? "Could not save." }); return; }
    setMessage({ ok: true, text: "Saved" });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3 border-b border-border py-3 last:border-b-0">
      {fields.map((field) => (
        <label key={field.name} className="flex flex-col text-xs text-slate-500">
          {field.label}
          {field.type === "checkbox" ? <input type="checkbox" className="mt-2 h-4 w-4" checked={Boolean(row[field.name])} onChange={(e) => setRow({ ...row, [field.name]: e.target.checked })} />
            : field.type === "select" ? <select className="mt-1 rounded-md border border-border px-2 py-1.5 text-sm text-slate-800" value={String(row[field.name] ?? "")} onChange={(e) => setRow({ ...row, [field.name]: e.target.value })}>{field.options?.map((o) => <option key={o}>{o}</option>)}</select>
            : <input className="mt-1 w-32 rounded-md border border-border px-2 py-1.5 text-sm text-slate-800" type={field.type} step="any" value={String(row[field.name] ?? "")} onChange={(e) => setRow({ ...row, [field.name]: e.target.value })} />}
        </label>
      ))}
      <button disabled={busy} className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">{submitLabel}</button>
      {message && <span className={`text-xs ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</span>}
    </form>
  );
}

export type AdminConfigProps = {
  trust: Row;
  contact: { enabled: boolean; minDigits: number; extraPatterns: string };
  savedSearch: Row;
  boostPackages: Row[];
  proPlans: Row[];
  achievements: Row[];
  ruleTypes: string[];
};

function ContactEditor({ initial }: { initial: AdminConfigProps["contact"] }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const data = { enabled: state.enabled, minDigits: Number(state.minDigits), extraPatterns: state.extraPatterns.split("\n").map((l) => l.trim()).filter(Boolean) };
    const response = await fetch("/api/admin/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "contact", data }) });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? { ok: true, text: "Saved" } : { ok: false, text: result.error ?? "Could not save." });
    if (response.ok) router.refresh();
  }
  return (
    <form onSubmit={save} className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={state.enabled} onChange={(e) => setState({ ...state, enabled: e.target.checked })} />Hide contact details in public listings</label>
      <label className="block text-xs text-slate-500">Minimum digits that count as a phone number<input type="number" min={6} max={15} className="ml-2 w-20 rounded-md border border-border px-2 py-1 text-sm text-slate-800" value={state.minDigits} onChange={(e) => setState({ ...state, minDigits: Number(e.target.value) })} /></label>
      <label className="block text-xs text-slate-500">Extra patterns to hide (one regular expression per line)<textarea rows={3} className="mt-1 w-full rounded-md border border-border px-2 py-1.5 font-mono text-sm text-slate-800" value={state.extraPatterns} onChange={(e) => setState({ ...state, extraPatterns: e.target.value })} /></label>
      <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white">Save contact rules</button>
      {message && <span className={`ml-3 text-xs ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</span>}
    </form>
  );
}

const section = "rounded-lg border border-border bg-white p-5";

export function AdminConfigEditor(props: AdminConfigProps) {
  const trustFields: Field[] = Object.keys(props.trust).map((name) => ({ name, label: name, type: "number" }));
  const packageFields: Field[] = [{ name: "key", label: "Key", type: "text" }, { name: "name", label: "Name", type: "text" }, { name: "description", label: "Description", type: "text" }, { name: "priceCents", label: "Price (R)", type: "number", scale: 100 }, { name: "durationDays", label: "Days", type: "number" }, { name: "priority", label: "Priority", type: "number" }, { name: "enabled", label: "Enabled", type: "checkbox" }];
  const proFields: Field[] = [{ name: "name", label: "Name", type: "text" }, { name: "priceCents", label: "Price (R)", type: "number", scale: 100 }, { name: "savedSearchLimit", label: "Saved search limit", type: "number" }, { name: "advancedAnalytics", label: "Advanced analytics", type: "checkbox" }, { name: "enabled", label: "Enabled", type: "checkbox" }];
  const achievementFields: Field[] = [{ name: "key", label: "Key", type: "text" }, { name: "name", label: "Name", type: "text" }, { name: "description", label: "Description", type: "text" }, { name: "ruleType", label: "Rule", type: "select", options: props.ruleTypes }, { name: "threshold", label: "Threshold", type: "number" }, { name: "enabled", label: "Enabled", type: "checkbox" }];
  const centsToRand = (row: Row) => ({ ...row, priceCents: Number(row.priceCents) / 100 });
  return (
    <div className="space-y-6">
      <section className={section}><h2 className="font-semibold">Vera Trust weights</h2><p className="mt-1 text-xs text-slate-500">Points awarded or removed for each real signal. The score is always clamped to 0–100.</p><RowEditor section="trust" fields={trustFields} initial={props.trust} submitLabel="Save trust config" /></section>
      <section className={section}><h2 className="font-semibold">Contact-information detection</h2><div className="mt-3"><ContactEditor initial={props.contact} /></div></section>
      <section className={section}><h2 className="font-semibold">Saved-search alerts</h2><RowEditor section="savedSearch" fields={[{ name: "enabled", label: "Alerts enabled", type: "checkbox" }, { name: "maxPerUser", label: "Max per user", type: "number" }]} initial={props.savedSearch} submitLabel="Save" /></section>
      <section className={section}><h2 className="font-semibold">Vera Boost packages</h2>{props.boostPackages.map((p) => <RowEditor key={String(p.id)} section="boostPackage" fields={packageFields} initial={centsToRand(p)} submitLabel="Save" />)}<h3 className="mt-4 text-sm font-medium">Add package</h3><RowEditor section="boostPackage" fields={packageFields} initial={{ key: "", name: "", description: "", priceCents: 0, durationDays: 7, priority: 1, enabled: true }} submitLabel="Add" /></section>
      <section className={section}><h2 className="font-semibold">Vera Pro</h2>{props.proPlans.map((p) => <RowEditor key={String(p.id)} section="proPlan" fields={proFields} initial={centsToRand(p)} submitLabel="Save" />)}</section>
      <section className={section}><h2 className="font-semibold">Achievement rules</h2>{props.achievements.map((a) => <RowEditor key={String(a.id)} section="achievement" fields={achievementFields} initial={a} submitLabel="Save" />)}<h3 className="mt-4 text-sm font-medium">Add achievement</h3><RowEditor section="achievement" fields={achievementFields} initial={{ key: "", name: "", description: "", ruleType: props.ruleTypes[0], threshold: 1, enabled: true }} submitLabel="Add" /></section>
    </div>
  );
}