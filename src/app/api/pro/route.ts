import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";
import { secureAppUrl } from "@/lib/app-url";
import { activePro, getProPlan } from "@/lib/pro";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!integrations.paystack.configured) return NextResponse.json({ error: "Payments are not configured. Add Paystack credentials before accepting payment.", missing: integrations.paystack.missing }, { status: 503 });
  const plan = await getProPlan();
  if (!plan) return NextResponse.json({ error: "No Vera Pro plan is currently available." }, { status: 404 });
  if (await activePro(session.user.id)) return NextResponse.json({ error: "You already have an active Vera Pro subscription." }, { status: 409 });
  const reference = `vera_pro_${randomUUID()}`;
  const response = await fetch("https://api.paystack.co/transaction/initialize", { method: "POST", headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: session.user.email, amount: plan.priceCents, currency: "ZAR", reference, callback_url: `${secureAppUrl()}/pro`, metadata: { purpose: "PRO_SUBSCRIPTION", planId: plan.id, userId: session.user.id } }) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.status || !data?.data?.authorization_url) return NextResponse.json({ error: "Payment initialization failed. No subscription was created." }, { status: 502 });
  await prisma.proSubscription.create({ data: { user: { connect: { id: session.user.id } }, plan: { connect: { id: plan.id } }, status: "PENDING_PAYMENT", payment: { create: { user: { connect: { id: session.user.id } }, purpose: "PRO_SUBSCRIPTION", amountCents: plan.priceCents, providerRef: reference, status: "PENDING" } } } });
  return NextResponse.json({ authorizationUrl: data.data.authorization_url, reference }, { status: 201 });
}