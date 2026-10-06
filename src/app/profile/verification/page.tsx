import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { integrations } from "@/lib/config";
import { PhoneVerification } from "@/components/verification/phone-verification";

export const dynamic = "force-dynamic";

export default async function VerificationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/profile/verification");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { identityVerification: true, phoneVerification: true } });
  if (!user) redirect("/login");
  return <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6"><h1 className="text-3xl font-semibold tracking-tight">Verification</h1><p className="mt-2 text-sm text-slate-500">Verification status is always tied to a real provider or reviewed request.</p><div className="mt-8 space-y-4"><StatusCard title="Identity verification" status={user.identityVerification} description="Identity documents are never exposed publicly." /><StatusCard title="Phone verification" status={user.phoneVerification} description={integrations.twilio.configured ? "SMS verification is available." : `SMS verification is not configured. Missing: ${integrations.twilio.missing.join(", ")}.`} /></div></div>;
}
function StatusCard({ title, status, description }: { title: string; status: string; description: string }) { return <div className="rounded-lg border border-border bg-white p-5"><div className="flex items-center justify-between gap-4"><h2 className="font-semibold">{title}</h2><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{status.replaceAll("_", " ")}</span></div><p className="mt-3 text-sm text-slate-500">{description}</p>{title === "Phone verification" && <PhoneVerification verified={status === "VERIFIED"} />}</div>; }
