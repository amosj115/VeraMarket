import { z } from "zod";

// Shared registration limits — the register form mirrors these as input
// constraints so client and server validation always agree.
export const REGISTER_LIMITS = {
  displayName: 60,
  usernameMin: 3,
  username: 30,
  email: 254,
  passwordMin: 8,
  // bcryptjs (like bcrypt) silently ignores every byte past 72, so the cap is
  // measured in UTF-8 bytes as well as characters.
  passwordBytes: 72,
} as const;

export const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters.")
    .max(
      REGISTER_LIMITS.displayName,
      `Full name must be ${REGISTER_LIMITS.displayName} characters or fewer.`
    ),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(
      REGISTER_LIMITS.usernameMin,
      `Username must be between ${REGISTER_LIMITS.usernameMin} and ${REGISTER_LIMITS.username} characters.`
    )
    .max(
      REGISTER_LIMITS.username,
      `Username must be between ${REGISTER_LIMITS.usernameMin} and ${REGISTER_LIMITS.username} characters.`
    )
    .regex(
      /^[a-z0-9_]+$/,
      "Username can only contain lowercase letters, numbers and underscores."
    ),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address.")
    .max(
      REGISTER_LIMITS.email,
      `Email must be ${REGISTER_LIMITS.email} characters or fewer.`
    ),
  password: z
    .string()
    .min(
      REGISTER_LIMITS.passwordMin,
      "Password must be at least 8 characters."
    )
    .max(
      REGISTER_LIMITS.passwordBytes,
      `Password must be ${REGISTER_LIMITS.passwordBytes} characters or fewer.`
    )
    .regex(/[A-Z]/, "Password must contain an uppercase letter.")
    .regex(/[a-z]/, "Password must contain a lowercase letter.")
    .regex(/[0-9]/, "Password must contain a number.")
    .refine(
      (value) =>
        new TextEncoder().encode(value).length <= REGISTER_LIMITS.passwordBytes,
      {
        message: `Password must be ${REGISTER_LIMITS.passwordBytes} bytes or fewer — some characters (such as emoji) use several bytes each.`,
        path: ["password"],
      }
    ),
});

export type RegisterInput = z.infer<typeof registerSchema>;

const FIELD_LABELS: Record<string, string> = {
  displayName: "Full name",
  username: "Username",
  email: "Email",
  password: "Password",
};

// Turns validation issues into clear, field-identified messages. Users must
// never see raw library texts such as "Too big: expected string to have...".
export function registerErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input. Please check your details and try again.";
  const field = String(issue.path[0] ?? "");
  const label = FIELD_LABELS[field] ?? "Your details";
  if (issue.code === "invalid_type" && issue.input === undefined) {
    return `${label} is required.`;
  }
  if (field && !issue.message) {
    return `Please check your ${label.toLowerCase()}.`;
  }
  return issue.message;
}

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;
