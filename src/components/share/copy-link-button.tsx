"use client";

import { useState } from "react";

export function CopyLinkButton({ url, className = "" }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  }
  return (
    <button type="button" onClick={copy} className={`rounded-md border border-border px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand hover:text-brand ${className}`}>
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}