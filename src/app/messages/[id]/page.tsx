import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { expireStaleOffers } from "@/lib/offers";
import { markConversationNotificationsRead } from "@/lib/notifications";
import { MessageComposer } from "@/components/messages/message-composer";
import { ChatActions } from "@/components/messages/chat-actions";
import { OfferCard } from "@/components/messages/offer-card";
import { MakeOfferForm } from "@/components/messages/make-offer-form";
import { NotificationsAnnouncer } from "@/components/notifications/notifications-announcer";

export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const me = session.user.id;
  await expireStaleOffers({ conversationId: id });
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      userA: { select: { id: true, displayName: true, username: true } },
      userB: { select: { id: true, displayName: true, username: true } },
      listing: { select: { id: true, title: true, slug: true, priceCents: true, status: true, sellerId: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } },
      messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { id: true, displayName: true } } } },
    },
  });
  if (!conversation || (conversation.userAId !== me && conversation.userBId !== me)) notFound();
  const other = conversation.userAId === me ? conversation.userB : conversation.userA;
  const archived = conversation.userAId === me ? conversation.archivedByA : conversation.archivedByB;
  const [block, offers] = await Promise.all([
    prisma.userBlock.findFirst({ where: { OR: [{ blockerId: me, blockedId: other.id }, { blockerId: other.id, blockedId: me }] }, select: { blockerId: true } }),
    prisma.offer.findMany({ where: { conversationId: id } }),
  ]);
  await prisma.message.updateMany({ where: { conversationId: id, senderId: { not: me }, readAt: null }, data: { readAt: new Date() } });
  await markConversationNotificationsRead(me, id);
  const offerById = new Map(offers.map((offer) => [offer.id, offer]));
  const listing = conversation.listing;
  const iAmBuyer = listing ? listing.sellerId !== me : false;
  const canOffer = Boolean(listing && iAmBuyer && listing.status === "ACTIVE" && !block && !offers.some((o) => o.status === "PENDING" || o.status === "ACCEPTED"));

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <NotificationsAnnouncer />
      <Link href="/messages" className="text-sm font-medium text-brand">&larr; Back to messages</Link>
      <div className="mt-4 border-b border-border pb-4">
        <h1 className="text-2xl font-semibold">{other.displayName}</h1>
        <p className="text-sm text-slate-500">@{other.username}</p>
        {listing && (
          <Link href={`/listing/${listing.slug}`} className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-slate-50 p-3 hover:bg-slate-100">
            {listing.images[0] && <Image src={listing.images[0].url} alt="" width={56} height={56} sizes="56px" className="h-14 w-14 rounded-md object-cover" />}
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{listing.title}</span><span className="block text-sm text-slate-600">{formatZAR(listing.priceCents)}{listing.status !== "ACTIVE" ? ` · ${listing.status.toLowerCase()}` : ""}</span></span>
            <span className="ml-auto shrink-0 text-xs font-medium text-brand">View listing</span>
          </Link>
        )}
        <ChatActions conversationId={id} otherUserId={other.id} blockedByMe={block?.blockerId === me} archived={archived} />
      </div>
      <details className="mt-4 rounded-md border border-blue-100 bg-brand-light px-4 py-2.5 text-xs text-slate-700 open:pb-3">
        <summary className="cursor-pointer select-none text-sm font-semibold text-brand">🛡️ Stay safe on Vera Market</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
          <li>Meet in a public, well-lit place.</li>
          <li>Inspect the item before making payment.</li>
          <li>Confirm payment directly with the seller or buyer when you meet.</li>
          <li>Never share your banking PIN, password, or one-time verification codes.</li>
          <li>Be cautious of payment screenshots or notifications that you cannot independently verify.</li>
        </ul>
      </details>
      <div className="my-6 min-h-80 space-y-3">
        {conversation.messages.map((message) => {
          const mine = message.senderId === me;
          if (message.kind === "SYSTEM") return <p key={message.id} className="mx-auto max-w-md rounded-md bg-slate-100 px-3 py-2 text-center text-xs text-slate-600">{message.body}</p>;
          const offer = message.kind === "OFFER" && message.offerId ? offerById.get(message.offerId) : null;
          if (offer) return <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><OfferCard disabled={Boolean(block)} offer={{ id: offer.id, amountLabel: formatZAR(offer.amountCents), status: offer.status, madeByMe: offer.madeById === me, iAmSeller: offer.sellerId === me, expiresAt: offer.expiresAt.toISOString() }} /></div>;
          return <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${mine ? "bg-brand text-white" : "bg-slate-100 text-slate-700"}`}><p className="whitespace-pre-wrap break-words">{message.body}</p><p className={`mt-1 text-[11px] ${mine ? "text-blue-100" : "text-slate-400"}`}>{message.createdAt.toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}{mine && message.readAt ? " · Read" : ""}</p></div></div>;
        })}
      </div>
      {block ? <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">{block.blockerId === me ? "You blocked this user. Unblock them to continue the conversation." : "You can no longer message this user."}</p> : <div className="space-y-4">{canOffer && listing && <MakeOfferForm conversationId={id} askingLabel={formatZAR(listing.priceCents)} />}<MessageComposer conversationId={id} /></div>}
    </div>
  );
}