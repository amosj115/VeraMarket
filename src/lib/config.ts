/**
 * Centralised feature-flag helpers. Vera Market must never pretend an
 * integration (SMS, payments, email, object storage) is active when the
 * required credentials have not been configured. Every part of the app that
 * depends on an external provider should check these flags and render a
 * clear "not configured" state instead of faking success.
 */

export const integrations = {
  twilio: {
    configured: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_VERIFY_SERVICE_SID
    ),
    missing: [
      !process.env.TWILIO_ACCOUNT_SID && "TWILIO_ACCOUNT_SID",
      !process.env.TWILIO_AUTH_TOKEN && "TWILIO_AUTH_TOKEN",
      !process.env.TWILIO_VERIFY_SERVICE_SID && "TWILIO_VERIFY_SERVICE_SID",
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
