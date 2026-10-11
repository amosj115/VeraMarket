import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AccountManagement } from "@/components/admin/account-management";

export const dynamic = "force-dynamic";

// Account management is ADMIN-only, consistent with /admin/config and /admin/trending.
export default async function AdminAccountsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const users = await prisma.user.findMany({
    where: query
      ? { OR: [{ username: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { displayName: { contains: query, mode: "insensitive" } }] }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      accountHolds: { where: { active: true }, select: { id: true, reason: true, placedAt: true, placedBy: { select: { username: true } } }, take: 1 },
      _count: { select: { listings: true, shops: true } },
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-sm font-medium text-brand">Admin</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Account management</h1>
      <p className="mt-2 text-sm text-slate-500">Place accounts on hold during an investigation, restore them, or delete an account.</p>

      <form method="get" action="/admin/accounts" className="mt-6 flex gap-2">
        <input name="q" defaultValue={query} placeholder="Search by username, email or name" className="w-full max-w-sm rounded-md border border-border p-2.5 text-sm outline-none focus:border-brand" />
        <button className="rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Search</button>
      </form>

      {users.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-16 text-center text-sm text-slate-500">No accounts found.</div>
      ) : (
        <div className="mt-8 space-y-4">
          {users.map((user) => {
            const hold = user.accountHolds[0];
            return (
              <div key={user.id} className="rounded-lg border border-border bg-white p-5">
                <div className="flex flex-col justify-between gap-4 sm:flex-row">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{user.displayName}</p>
                        <p className="mt-0.5 truncate text-sm text-slate-500">@{user.username} · {user.email}</p>
                        <p className="mt-2 text-xs text-slate-400">{user.role} · {user.status.replaceAll("_", " ")} · {user._count.listings} listings · {user._count.shops} shops · joined {user.createdAt.toLocaleDateString("en-ZA", { month: "short", year: "numeric" })}</p>
                        {hold && (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <p className="font-medium">On hold</p>
                        <p className="mt-1">{hold.reason}</p>
                        <p className="mt-1 text-xs text-amber-700">Placed by @{hold.placedBy.username} · {hold.placedAt.toLocaleString("en-ZA")}</p>
                      </div>
                    )}
                  </div>
                  <AccountManagement user={{ id: user.id, username: user.username, role: user.role, status: user.status, activeHold: hold ? { reason: hold.reason } : null }} selfId={session.user.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
