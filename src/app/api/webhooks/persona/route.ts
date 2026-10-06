import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyIdentityState } from "@/lib/identity-verification";
import { mapInquiryStatus, verifyPersonaSignature } from "@/lib/persona";

type PersonaEvent = {
  data?: {
    id?: string;
    attributes?: {
      name?: string;
      "created-at"?: string;
      payload?: { data?: { type?: string; id?: string; attributes?: { status?: string; "reference-id"?: string | null } } };
    };
  };
};

export async function POST(request: NextRequest) {
  const secret = process.env.PERSONA_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });

  // The signature covers the exact raw body, so read it as text before parsing.
  const rawBody = await request.text();
  if (!verifyPersonaSignature(rawBody, request.headers.get("persona-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: PersonaEvent;
  try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const eventId = event.data?.id;
  const inquiry = event.data?.attributes?.payload?.data;
  const name = event.data?.attributes?.name ?? "";
  if (!eventId || !name.startsWith("inquiry.") || inquiry?.type !== "inquiry" || !inquiry.id) return NextResponse.json({ ignored: true });

  const state = mapInquiryStatus(inquiry.attributes?.status ?? "");
  if (!state) return NextResponse.json({ ignored: true });
  const createdAt = event.data?.attributes?.["created-at"];
  const eventAt = createdAt && !Number.isNaN(Date.parse(createdAt)) ? new Date(createdAt) : new Date();

  try {
    await prisma.webhookEvent.create({ data: { id: eventId, provider: "persona" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ duplicate: true });
    throw error;
  }

  try {
    const result = await applyIdentityState(inquiry.id, state, eventAt, { expectUserId: inquiry.attributes?.["reference-id"] ?? undefined });
    return NextResponse.json({ received: true, applied: result.applied });
  } catch (error) {
    // Let Persona retry: forget the event id so the retry isn't treated as a duplicate.
    await prisma.webhookEvent.delete({ where: { id: eventId } }).catch(() => {});
    console.error("[persona] webhook processing failed", error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
