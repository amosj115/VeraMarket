import { NextRequest, NextResponse } from "next/server";
import { secureAppUrl } from "@/lib/app-url";
import { peachProvider, peachWebhookUrl } from "@/lib/payments/peach";
import { applyVerifiedPayment } from "@/lib/payments/service";
import { prisma } from "@/lib/prisma";

// Peach-specific notification endpoint. The signature authenticates the sender, but the payload is
// never trusted: we only take the checkout id from it and re-query Peach for the real status.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const verification = peachProvider.verifyWebhook({ headers: request.headers, rawBody, url: peachWebhookUrl(secureAppUrl()) });
  if (!verification.ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  if (!verification.checkoutId) return NextResponse.json({ ok: true, ignored: true });

  const payment = await prisma.payment.findUnique({ where: { providerCheckoutId: verification.checkoutId }, select: { providerRef: true } });
  if (!payment) return NextResponse.json({ ok: true, ignored: true });

  try {
    const verified = await peachProvider.fetchCheckoutStatus(verification.checkoutId);
    const outcome = await applyVerifiedPayment("peach", { ...verified, providerRef: payment.providerRef }, { webhookEventId: verification.eventId });
    return NextResponse.json({ ok: true, outcome });
  } catch {
    // Non-200 makes Peach retry later.
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
