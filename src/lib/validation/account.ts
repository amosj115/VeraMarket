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

export const adminDeleteAccountSchema = z.object({
  userId: z.string().cuid(),
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500),
});
