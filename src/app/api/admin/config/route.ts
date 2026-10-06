import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CONTACT_RULES } from "@/lib/contact-guard";
import { getTrustConfig } from "@/lib/trust";
import { getSavedSearchSettings } from "@/lib/saved-searches";
import { ensureBoostPackages } from "@/lib/boosts";
import { ensureProPlan } from "@/lib/pro";
import { ensureDefaultAchievements, RULE_TYPES } from "@/lib/achievements";

async function adminOnly() {
  const session = await auth();
  return session?.user && session.user.role === "ADMIN" ? session : null;
}

const num = z.number().finite().min(0).max(1_000_000);
const trustSchema = z.object({ verifiedPerson: num, emailVerified: num, phoneVerified: num, accountAgeMax: num, accountAgeDays: num, perSale: num, salesMax: num, reviewsMax: num, reportPenalty: num, reportPenaltyMax: num, contactViolationPenalty: num, contactViolationPenaltyMax: num, newAccountDays: num, newAccountFloor: z.number().min(0).max(100) });
const contactSchema = z.object({ enabled: z.boolean(), minDigits: z.number().int().min(6).max(15), extraPatterns: z.array(z.string().max(200)).max(50) });
const savedSchema = z.object({ enabled: z.boolean(), maxPerUser: z.number().int().min(1).max(500) });
const packageSchema = z.object({ id: z.string().cuid().optional(), key: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/), name: z.string().trim().min(1).max(60), description: z.string().trim().max(200), priceCents: z.number().int().min(100).max(10_000_000), durationDays: z.number().int().min(1).max(365), priority: z.number().int().min(1).max(10), enabled: z.boolean() });
const proSchema = z.object({ id: z.string().cuid(), name: z.string().trim().min(1).max(60), priceCents: z.number().int().min(100).max(10_000_000), enabled: z.boolean(), savedSearchLimit: z.number().int().min(0).max(1000), advancedAnalytics: z.boolean() });
const achievementSchema = z.object({ id: z.string().cuid().optional(), key: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/), name: z.string().trim().min(1).max(60), description: z.string().trim().max(200), ruleType: z.enum(RULE_TYPES), threshold: z.number().int().min(1).max(100000), enabled: z.boolean() });
const bodySchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("trust"), data: trustSchema }),
  z.object({ section: z.literal("contact"), data: contactSchema }),
  z.object({ section: z.literal("savedSearch"), data: savedSchema }),
  z.object({ section: z.literal("boostPackage"), data: packageSchema }),
  z.object({ section: z.literal("proPlan"), data: proSchema }),
  z.object({ section: z.literal("achievement"), data: achievementSchema }),
]);

export async function GET() {
  if (!(await adminOnly())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await Promise.all([ensureBoostPackages(), ensureProPlan(), ensureDefaultAchievements()]);
  const contactRow = await prisma.siteSetting.findUnique({ where: { key: "contact-rules" } });
  const [trust, savedSearch, boostPackages, proPlans, achievements, violations] = await Promise.all([
    getTrustConfig(), getSavedSearchSettings(),
    prisma.boostPackage.findMany({ orderBy: { priceCents: "asc" } }),
    prisma.proPlan.findMany({ orderBy: { priceCents: "asc" } }),
    prisma.achievement.findMany({ orderBy: { threshold: "asc" } }),
    prisma.contactViolation.groupBy({ by: ["userId"], _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 10 }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: violations.map((v) => v.userId) } }, select: { id: true, username: true, status: true } });
  const suspicious = violations.map((v) => ({ ...v, user: users.find((u) => u.id === v.userId) }));
  return NextResponse.json({ trust, contact: { ...DEFAULT_CONTACT_RULES, ...((contactRow?.value ?? {}) as object) }, savedSearch, boostPackages, proPlans, achievements, suspicious });
}

export async function PUT(request: NextRequest) {
  const session = await adminOnly();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid configuration" }, { status: 400 });
  const body = parsed.data;
  try {
    if (body.section === "trust") await prisma.siteSetting.upsert({ where: { key: "trust-config" }, update: { value: body.data }, create: { key: "trust-config", value: body.data } });
    else if (body.section === "contact") {
      for (const pattern of body.data.extraPatterns) { try { new RegExp(pattern, "i"); } catch { return NextResponse.json({ error: `Invalid pattern: ${pattern}` }, { status: 400 }); } }
      await prisma.siteSetting.upsert({ where: { key: "contact-rules" }, update: { value: body.data }, create: { key: "contact-rules", value: body.data } });
    } else if (body.section === "savedSearch") await prisma.siteSetting.upsert({ where: { key: "saved-search-settings" }, update: { value: body.data }, create: { key: "saved-search-settings", value: body.data } });
    else if (body.section === "boostPackage") { const { id, ...data } = body.data; if (id) await prisma.boostPackage.update({ where: { id }, data }); else await prisma.boostPackage.create({ data }); }
    else if (body.section === "proPlan") { const { id, savedSearchLimit, advancedAnalytics, ...rest } = body.data; await prisma.proPlan.update({ where: { id }, data: { ...rest, features: { savedSearchLimit, advancedAnalytics } } }); }
    else { const { id, ...data } = body.data; if (id) await prisma.achievement.update({ where: { id }, data }); else await prisma.achievement.create({ data }); }
  } catch {
    return NextResponse.json({ error: "Could not save. A record with that key may already exist." }, { status: 409 });
  }
  await prisma.auditLog.create({ data: { actorId: session.user.id, action: `CONFIG_${body.section.toUpperCase()}`, targetType: "Config", targetId: body.section, metadata: JSON.parse(JSON.stringify(body.data)) } });
  return NextResponse.json({ saved: true });
}