import { z } from "zod";

// Reauthentication for account deletion: the user re-enters their own password. This
// reuses the existing bcrypt `verifyPassword` primitive rather than inventing a new
// auth method, and the password travels over the same channel as login.
export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password to confirm."),
});

// Shared by admin hold / lift / delete. The target is always resolved server-side from
// the session for user-initiated deletion; here the admin supplies the target id, but the
// acting administrator is always taken from the verified session, never from the body.
export const adminHoldSchema = z.object({
  userId: z.string().cuid(),
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500),
});

export const adminLiftHoldSchema = z.object({
  userId: z.string().cuid(),
});

export const DELETION_REASONS = [
  "Scamming or fraudulent activity",
  "Suspicious behavior",
  "Robbery or reported theft",
  "Misleading or fraudulent listings",
  "Selling prohibited or illegal items",
  "Impersonation or false identity",
  "Repeated violations of Vera Market rules",
  "Harassment, threats, or abusive behavior",
  "Multiple credible user reports",
  "Spam or platform abuse",
  "Other",
] as const;

export const adminDeleteAccountSchema = z.object({
  userId: z.string().cuid(),
  reason: z.enum(DELETION_REASONS),
  customReason: z.string().trim().optional(),
});

// Flagging an account for review marks it under investigation; it is NOT a finding of
// wrongdoing. A flagged user keeps their account and can still browse, buy and message —
// they simply cannot create or publish new content until an admin clears the flag
// (see src/lib/review-enforcement.ts).
export const adminReviewFlagSchema = z.object({
  userId: z.string().cuid(),
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500).optional(),
});
