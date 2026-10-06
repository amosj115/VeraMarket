"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { channelHref, defaultShareMessage, sharedUrl, type ShareTarget } from "@/lib/share";

type Props = {
  target: ShareTarget;
  targetId: string;
  url: string;
  title: string;
  label?: string;
  variant?: "primary" | "outline" | "subtle";
  className?: string;
};

const styles = {
  primary: "bg-brand text-white hover:opacity-90",
  outline: "border border-brand text-brand hover:bg-brand-light",
  subtle: "border border-border text-slate-700 hover:border-brand hover:text-brand",
};

function track(target: ShareTarget, id: string, channel: string) {
  void fetch("/api/share/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: target, targetId: id, kind: "SHARE", channel }), keepalive: true }).catch(() => {});
}

export function ShareButton({ target, targetId, url, title, label = "Share", variant = "subtle", className = "" }: Props) {
  const link = sharedUrl(url);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(() => defaultShareMessage(target, link, title));
  const [copied, setCopied] = useState<"link" | "message" | "failed" | null>(null);
  const canNative = useSyncExternalStore(() => () => {}, () => typeof navigator.share === "function", () => false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Whatever the seller edits, the link must still be in the message.
  const finalMessage = message.includes(link) ? message : `${message.trim()}\n${link}`;

  async function copy(text: string, which: "link" | "message") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      if (which === "link") track(target, targetId, "copy");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2500);
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, text: finalMessage.replace(link, "").trim(), url: link });
      track(target, targetId, "native");
    } catch {
      // The user dismissed the share sheet.
    }
  }

  const channels = [
    { id: "whatsapp", name: "WhatsApp" },
    { id: "facebook", name: "Facebook" },
    { id: "x", name: "X" },
    { id: "telegram", name: "Telegram" },
    { id: "email", name: "Email" },
  ] as const;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2.5 text-sm font-semibold ${styles[variant]} ${className}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>
        {label}
      </button>
      <dialog ref={dialog} onClose={() => setOpen(false)} onClick={(e) => { if (e.target === dialog.current) setOpen(false); }} aria-label={`Share ${title}`} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-white p-0 shadow-xl backdrop:bg-slate-900/40">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Share</h2><p className="mt-0.5 line-clamp-1 text-sm text-slate-500">{title}</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button></div>
          <label className="mt-4 block text-sm font-medium" htmlFor={`share-msg-${targetId}`}>Message</label>
          <textarea id={`share-msg-${targetId}`} value={message} onChange={(e) => setMessage(e.target.value)} rows={5} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm leading-5" />
          <p className="mt-1 text-xs text-slate-500">Edit the message before sharing. The link is always included.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {channels.map((c) => <a key={c.id} href={channelHref(c.id, finalMessage, link, title)} target={c.id === "email" ? undefined : "_blank"} rel="noopener noreferrer" onClick={() => track(target, targetId, c.id)} className="rounded-md border border-border px-3 py-2.5 text-center text-sm font-medium hover:border-brand hover:text-brand">{c.name}</a>)}
            <button type="button" onClick={() => copy(link, "link")} className="rounded-md border border-border px-3 py-2.5 text-sm font-medium hover:border-brand hover:text-brand">{copied === "link" ? "Link copied ✓" : "Copy link"}</button>
            {canNative && <button type="button" onClick={nativeShare} className="col-span-2 rounded-md bg-brand px-3 py-2.5 text-sm font-semibold text-white sm:col-span-3">More options…</button>}
          </div>
          <button type="button" onClick={() => copy(finalMessage, "message")} className="mt-3 text-xs font-medium text-brand">{copied === "message" ? "Message copied ✓" : "Copy message (for WhatsApp Status, Instagram…)"}</button>
          {copied === "failed" && <p role="alert" className="mt-2 text-xs text-red-700">Couldn&apos;t copy automatically. Select the link and copy it manually: {link}</p>}
        </div>
      </dialog>
    </>
  );
}