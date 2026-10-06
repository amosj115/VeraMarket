import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/messages");

  const showArchived = (await searchParams).archived === "1";
  const me = session.user.id;
  const conversations = await prisma.conversation.findMany({
    where: { OR: [{ userAId: me, archivedByA: showArchived }, { userBId: me, archivedByB: showArchived }] },
    orderBy: { updatedAt: "desc" },
    include: {
      userA: { select: { id: true, displayName: true, username: true } },
      userB: { select: { id: true, displayName: true, username: true } },
      listing: { select: { title: true, slug: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { messages: { where: { senderId: { not: me }, readAt: null } } } },
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-sm font-medium text-brand">Private communication</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Messages</h1>
      <p className="mt-2 text-sm text-slate-500">Your conversations stay inside Vera Market.</p>
      <div className="mt-4 flex gap-2 text-sm"><Link href="/messages" className={`rounded-full px-3 py-1 ${showArchived ? "text-slate-500" : "bg-brand text-white"}`}>Inbox</Link><Link href="/messages?archived=1" className={`rounded-full px-3 py-1 ${showArchived ? "bg-brand text-white" : "text-slate-500"}`}>Archived</Link></div>
      <div className="mt-8 overflow-hidden rounded-lg border border-border bg-white">
        {conversations.length === 0 ? <div className="px-6 py-16 text-center"><p className="font-medium">No messages yet</p><p className="mt-1 text-sm text-slate-500">When you contact a seller, the conversation will appear here.</p><Link href="/marketplace" className="mt-5 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Browse marketplace</Link></div> : conversations.map((conversation) => { const other = conversation.userAId === session.user.id ? conversation.userB : conversation.userA; const latest = conversation.messages[0]; return <Link key={conversation.id} href={`/messages/${conversation.id}`} className="block border-b border-border p-5 last:border-b-0 hover:bg-slate-50"><div className="flex items-center justify-between gap-4"><div><p className="font-medium">{other.displayName}{conversation._count.messages > 0 && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[11px] text-white">{conversation._count.messages} new</span>}</p><p className="text-sm text-slate-500">@{other.username}</p></div>{conversation.listing && <span className="max-w-[45%] truncate text-right text-xs text-brand">{conversation.listing.title}</span>}</div><p className="mt-3 truncate text-sm text-slate-600">{latest ? (latest.kind === "OFFER" ? "Offer: " : "") + latest.body : "No messages yet"}</p></Link>; })}
      </div>
    </div>
  );
}
