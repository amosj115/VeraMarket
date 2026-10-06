import { createHmac, timingSafeEqual } from "node:crypto";
import type { IdentityVerificationState } from "@prisma/client";

const API_BASE = "https://withpersona.com/api/v1";
const API_VERSION = "2023-01-05";
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export class PersonaError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

async function personaFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.PERSONA_API_KEY}`, "Persona-Version": API_VERSION, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new PersonaError(`Persona responded ${response.status}`, response.status);
  return body as { data?: { id?: string; attributes?: Record<string, unknown> }; meta?: Record<string, unknown> };
}

export type PersonaSession = { inquiryId: string; sessionToken: string };

/** Creates a Persona inquiry bound to our user id (reference-id) and returns what the browser SDK needs. */
export async function createInquiry(userId: string): Promise<PersonaSession> {
  const created = await personaFetch("/inquiries", {
    method: "POST",
    body: JSON.stringify({ data: { attributes: { "inquiry-template-id": process.env.PERSONA_INQUIRY_TEMPLATE_ID, "reference-id": userId } } }),
  });
  const inquiryId = created.data?.id;
  if (!inquiryId) throw new PersonaError("Persona did not return an inquiry id");
  const sessionToken = (created.meta?.["session-token"] as string | undefined) ?? (await resumeInquiry(inquiryId)).sessionToken;
  return { inquiryId, sessionToken };
}

export async function resumeInquiry(inquiryId: string): Promise<PersonaSession> {
  const resumed = await personaFetch(`/inquiries/${encodeURIComponent(inquiryId)}/resume`, { method: "POST", body: "{}" });
  const sessionToken = resumed.meta?.["session-token"] as string | undefined;
  if (!sessionToken) throw new PersonaError("Persona did not return a session token");
  return { inquiryId, sessionToken };
}

/**
 * Persona-Signature: `t=<unix>,v1=<hex>` (several space-separated pairs while a secret rotates).
 * The digest is HMAC-SHA256 of `${t}.${rawBody}`.
 */
export function verifyPersonaSignature(rawBody: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const pairs = header.trim().split(/\s+/).map((part) => {
    const fields = Object.fromEntries(part.split(",").map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));
    return { t: fields.t as string | undefined, v1: fields.v1 as string | undefined };
  });
  return pairs.some(({ t, v1 }) => {
    if (!t || !v1 || !/^\d+$/.test(t) || Math.abs(nowSeconds - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;
    const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
    const received = Buffer.from(v1);
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}

export const FAILURE_MESSAGES: Record<string, string> = {
  DECLINED: "We couldn't verify your identity. Please make sure your ID and face are clearly visible and try again.",
  FAILED: "The identity check didn't pass. Please try again with good lighting and a valid, unexpired ID.",
  EXPIRED: "Your verification session expired. Please start again.",
  CANCELLED: "Verification was cancelled. You can start it again whenever you're ready.",
};

/** Maps a Persona inquiry status to our internal state. Only approved/completed ever verifies a user. */
export function mapInquiryStatus(status: string): IdentityVerificationState | null {
  switch (status) {
    case "created": return "CREATED";
    case "pending":
    case "needs_review": return "PENDING";
    case "completed":
    case "approved": return "APPROVED";
    case "declined": return "DECLINED";
    case "failed": return "FAILED";
    case "expired": return "EXPIRED";
    default: return null;
  }
}
