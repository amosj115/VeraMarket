import { prisma } from "@/lib/prisma";

export async function blockedBetween(a: string, b: string) {
  const row = await prisma.userBlock.findFirst({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { blockerId: true },
  });
  return row ? { blockedByMe: row.blockerId === a } : null;
}

// Patterns that commonly indicate off-platform payment scams; the message still sends, but both people get a reminder.
const PAYMENT_RISK = /\b(?:western\s*union|moneygram|gift\s*cards?|bank\s*details|banking\s*details|account\s*number|send\s+(?:me\s+)?(?:a\s+)?deposit|pay\s+(?:me\s+)?(?:a\s+)?deposit|eft\s+first|crypto|bitcoin|courier\s+fee)\b/i;

export function paymentRisk(body: string) {
  return PAYMENT_RISK.test(body);
}

export const SAFETY_REMINDER = "Safety reminder: never send money outside Vera Market's protected payment system, and be wary of requests for deposits, courier fees or gift cards.";
