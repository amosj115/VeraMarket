"use client";

import Image from "next/image";
import type { ChatGroupDto, SystemGroupDto } from "@/lib/notification-groups";
import { relativeTime } from "./notification-item";

export function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return <Image src={src} alt="" width={44} height={44} sizes="44px" className="h-11 w-11 shrink-0 rounded-full bg-slate-100 object-cover" />;
  }
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?";
  return (
    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-light text-sm font-semibold text-brand">
      {initials}
    </span>
  );
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-2 inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

const ROW_CLASS = "flex w-full items-start gap-3 px-4 py-3 text-left transition";

// One row per conversation: sender identity, unread message count, latest preview and time.
export function ChatGroupRow({ group, onNavigate }: { group: ChatGroupDto; onNavigate?: () => void }) {
  return (
    <a
      href={group.link}
      onClick={onNavigate}
      aria-label={`${group.displayName}, ${group.count} unread message${group.count === 1 ? "" : "s"}`}
      className={`${ROW_CLASS} bg-brand-light/60 hover:bg-brand-light`}
    >
      <Avatar src={group.avatarUrl} name={group.displayName} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{group.displayName}</span>
          <span className="shrink-0 text-xs text-slate-400">{relativeTime(group.lastMessageAt)}</span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-brand">
            {group.count === 1 ? "You have 1 new message" : `You have ${group.count} new messages`}
          </span>
          <CountBadge count={group.count} />
        </span>
        <span className="mt-0.5 line-clamp-1 block text-sm text-slate-600">{group.preview}</span>
      </span>
    </a>
  );
}

// Single aggregated row for every Vera Market system notification.
export function SystemGroupRow({ system, onNavigate }: { system: SystemGroupDto; onNavigate?: () => void }) {
  const unread = system.count > 0;
  return (
    <a
      href={system.link}
      onClick={onNavigate}
      aria-label={`Vera Market Updates, ${system.count} unread`}
      className={`${ROW_CLASS} ${unread ? "bg-brand-light/60 hover:bg-brand-light" : "bg-white hover:bg-slate-50"}`}
    >
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
        V
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            Vera Market Updates
            <CountBadge count={system.count} />
          </span>
          {system.lastAt && <span className="shrink-0 text-xs text-slate-400">{relativeTime(system.lastAt)}</span>}
        </span>
        <span className={`mt-0.5 block text-sm ${unread ? "font-medium text-brand" : "text-slate-500"}`}>
          {unread ? `${system.count} new update${system.count === 1 ? "" : "s"}` : "You\u2019re all caught up"}
        </span>
        <span className="mt-0.5 line-clamp-1 block text-sm text-slate-600">{system.preview}</span>
      </span>
    </a>
  );
}
