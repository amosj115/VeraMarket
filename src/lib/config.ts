/**
 * Centralised feature-flag helpers. Vera Market must never pretend an
 * integration (SMS, payments, email, object storage) is active when the
 * required credentials have not been configured. Every part of the app that
 * depends on an external provider should check these flags and render a
 * clear "not configured" state instead of faking success.
 */

export const integrations = {
  smsMessenger: {
    configured: Boolean(
      process.env.SMS_MESSENGER_EMAIL && process.env.SMS_MESSENGER_API_TOKEN
    ),
    missing: [
      !process.env.SMS_MESSENGER_EMAIL && "SMS_MESSENGER_EMAIL",
      !process.env.SMS_MESSENGER_API_TOKEN && "SMS_MESSENGER_API_TOKEN",
    ].filter(Boolean) as string[],
  },
  paystack: {
    configured: Boolean(
      process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PUBLIC_KEY
    ),
    missing: [
      !process.env.PAYSTACK_SECRET_KEY && "PAYSTACK_SECRET_KEY",
      !process.env.PAYSTACK_PUBLIC_KEY && "PAYSTACK_PUBLIC_KEY",
      !process.env.PAYSTACK_WEBHOOK_SECRET && "PAYSTACK_WEBHOOK_SECRET",
    ].filter(Boolean) as string[],
  },
  email: {
    configured: Boolean(
      process.env.EMAIL_SERVER_HOST && process.env.EMAIL_SERVER_USER
    ),
    missing: [
      !process.env.EMAIL_SERVER_HOST && "EMAIL_SERVER_HOST",
      !process.env.EMAIL_SERVER_USER && "EMAIL_SERVER_USER",
      !process.env.EMAIL_SERVER_PASSWORD && "EMAIL_SERVER_PASSWORD",
    ].filter(Boolean) as string[],
  },
  persona: {
    configured: Boolean(process.env.PERSONA_API_KEY && process.env.PERSONA_INQUIRY_TEMPLATE_ID && process.env.PERSONA_WEBHOOK_SECRET),
    missing: [
      !process.env.PERSONA_API_KEY && "PERSONA_API_KEY",
      !process.env.PERSONA_INQUIRY_TEMPLATE_ID && "PERSONA_INQUIRY_TEMPLATE_ID",
      !process.env.PERSONA_WEBHOOK_SECRET && "PERSONA_WEBHOOK_SECRET",
    ].filter(Boolean) as string[],
  },
  faceVerification: {
    configured: Boolean(process.env.FACE_VERIFICATION_API_URL && process.env.FACE_VERIFICATION_API_KEY),
    missing: [
      !process.env.FACE_VERIFICATION_API_URL && "FACE_VERIFICATION_API_URL",
      !process.env.FACE_VERIFICATION_API_KEY && "FACE_VERIFICATION_API_KEY",
    ].filter(Boolean) as string[],
  },
  didit: {
    configured: Boolean(process.env.DIDIT_API_KEY),
    missing: [!process.env.DIDIT_API_KEY && "DIDIT_API_KEY"].filter(Boolean) as string[],
  },
  objectStorage: {
    configured: process.env.STORAGE_DRIVER === "s3" && Boolean(process.env.S3_BUCKET),
    missing:
      process.env.STORAGE_DRIVER === "s3"
        ? ([
            !process.env.S3_BUCKET && "S3_BUCKET",
            !process.env.S3_REGION && "S3_REGION",
            !process.env.S3_ACCESS_KEY_ID && "S3_ACCESS_KEY_ID",
            !process.env.S3_SECRET_ACCESS_KEY && "S3_SECRET_ACCESS_KEY",
          ].filter(Boolean) as string[])
        : [],
  },
} as const;

export const BOOST_PRICING_ZAR_CENTS: Record<
  "ONE_DAY" | "THREE_DAYS" | "SEVEN_DAYS" | "THIRTY_DAYS",
  number
> = {
  ONE_DAY: 2500,
  THREE_DAYS: 6000,
  SEVEN_DAYS: 12000,
  THIRTY_DAYS: 35000,
};

// Virtual Store subscription price (5900 = R59/month). This is the single source
// used when creating a store; each Shop row stores it in monthlyPriceCents and the
// seller is always charged the amount shown on their shop row before checkout.
export const VIRTUAL_STORE_MONTHLY_ZAR_CENTS = 5900;

/**
 * Prices for the percent-level listing boosts, in ZAR cents.
 *
 * ENTER PRICES HERE before selling them: a value of 0 means "not priced yet" and
 * every purchase attempt for that package is rejected with a clear error until a
 * real price exists. After seeding, admins can override each package price any time
 * under /admin/config -> "Vera Boost packages" (the database value wins over this
 * seed value), so this constant is only the default for a fresh environment.
 */
export const BOOST_VISIBILITY_PRICING_ZAR_CENTS: Record<
  "FIFTY_PERCENT" | "ONE_HUNDRED_PERCENT",
  number
> = {
  FIFTY_PERCENT: 0, // e.g. 9900 = R99 for 50% for 7 days
  ONE_HUNDRED_PERCENT: 0, // e.g. 17900 = R179 for 100% for 7 days
};
