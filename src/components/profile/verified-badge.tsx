export function VerifiedBadge({ verified, size = "sm" }: { verified: boolean; size?: "sm" | "md" }) {
  if (!verified) return null;
  return (
    <span
      title="This person appears to match their real profile photo. This is not a government ID check."
      className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 font-semibold text-emerald-700 ring-1 ring-emerald-200 ${size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"}`}
    >
      <svg viewBox="0 0 24 24" className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>
      Verified Person
    </span>
  );
}
