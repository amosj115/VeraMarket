import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CONTACT_RULES } from "@/lib/contact-guard";
import { getTrustConfig } from "@/lib/trust";
import { getSavedSearchSettings } from "@/lib/saved-searches";
import { ensureBoostPackages } from "@/lib/boosts";
import { ensureProPlan } from "@/lib/pro";
import { ensureDefaultAchievements, RULE_TYPES } from "@/lib/achievements";
import { AdminConfigEditor } from "@/components/admin/config-editor";

export const dynamic = "force-dynamic";

export default async function AdminConfigPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/config");
  if (session.user.role !== "ADMIN") redirect("/");
  await Promise.all([ensureBoostPackages(), ensureProPlan(), ensureDefaultAchievements()]);
  const [trust, savedSearch, boostPackages, proPlans, achievements, contactRow, violations] = await Promise.all([
    getTrustConfig(), getSavedSearchSettings(),
    prisma.boostPackage.findMany({ orderBy: { priceCents: "asc" } }),
    prisma.proPlan.findMany({ orderBy: { priceCents: "asc" } }),
    prisma.achievement.findMany({ orderBy: { threshold: "asc" } }),
    prisma.siteSetting.findUnique({ where: { key: "contact-rules" } }),
    prisma.contactViolation.groupBy({ by: ["userId"], _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 10 }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: violations.map((v) => v.userId) } }, select: { id: true, username: true } });
  const contact = { ...DEFAULT_CONTACT_RULES, ...((contactRow?.value ?? {}) as Partial<typeof DEFAULT_CONTACT_RULES>) };
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-sm font-medium text-brand">Admin</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Marketplace configuration</h1>
      <p className="mt-2 text-sm text-slate-500">Business rules live in the database. Changes apply immediately. See also <Link className="text-brand" href="/admin/reports">reports</Link> and <Link className="text-brand" href="/admin/moderation">moderation</Link>.</p>
      <div className="mt-8">
        <AdminConfigEditor trust={trust} contact={{ enabled: contact.enabled, minDigits: contact.minDigits, extraPatterns: contact.extraPatterns.join("\n") }} savedSearch={savedSearch} boostPackages={boostPackages} proPlans={proPlans.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents, enabled: p.enabled, savedSearchLimit: Number((p.features as Record<string, unknown>)?.savedSearchLimit ?? 0), advancedAnalytics: Boolean((p.features as Record<string, unknown>)?.advancedAnalytics) }))} achievements={achievements} ruleTypes={[...RULE_TYPES]} />
      </div>
      <section className="mt-6 rounded-lg border border-border bg-white p-5"><h2 className="font-semibold">Suspicious activity</h2><p className="mt-1 text-xs text-slate-500">Users who most often tried to publish contact details in public listings.</p>{violations.length === 0 ? <p className="mt-3 text-sm text-slate-500">None recorded.</p> : <ul className="mt-3 divide-y divide-border text-sm">{violations.map((v) => <li key={v.userId} className="flex justify-between py-2"><span>@{users.find((u) => u.id === v.userId)?.username ?? v.userId}</span><span className="text-slate-500">{v._count._all} attempts</span></li>)}</ul>}</section>
    </div>
  );
}