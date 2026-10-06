import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ReportStatusControl } from "@/components/admin/report-status-control";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const session = await auth();
  if (!session?.user || !["ADMIN", "MODERATOR"].includes(session.user.role)) redirect("/");
  const reports = await prisma.report.findMany({ where: { status: { in: ["OPEN", "INVESTIGATING"] } }, orderBy: { createdAt: "asc" }, include: { reporter: { select: { username: true, email: true } }, listing: { select: { title: true, slug: true } }, shop: { select: { name: true, slug: true } }, service: { select: { title: true, slug: true } }, property: { select: { title: true, slug: true } }, reportedUser: { select: { username: true } } } });
  return <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8"><p className="text-sm font-medium text-brand">Admin moderation</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Open reports</h1><p className="mt-2 text-sm text-slate-500">Review reports and record every moderation decision.</p>{reports.length === 0 ? <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-slate-500">No open reports.</div> : <div className="mt-8 space-y-4">{reports.map((report) => { const target = report.listing?.title ?? report.shop?.name ?? report.service?.title ?? report.property?.title ?? (report.reportedUser ? `User @${report.reportedUser.username} (chat/profile report)` : "Unknown content"); return <div key={report.id} className="rounded-lg border border-border bg-white p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="font-semibold">{target}</p><p className="mt-1 text-sm text-red-700">{report.reason}</p><p className="mt-2 text-sm text-slate-600">{report.details || "No additional details."}</p><p className="mt-3 text-xs text-slate-400">Reported by @{report.reporter.username} · {report.createdAt.toLocaleString("en-ZA")}</p></div><ReportStatusControl reportId={report.id} status={report.status} /></div></div>; })}</div>}</div>;
}
