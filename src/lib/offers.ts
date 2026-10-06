import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { evaluateAchievements } from "@/lib/achievements";

export const OFFER_TTL_MS = 48 * 60 * 60 * 1000;

export async function expireStaleOffers(where: { conversationId?: string; listingId?: string } = {}) {
  const stale = await prisma.offer.findMany({ where: { ...where, status: "PENDING", expiresAt: { lte: new Date() } }, select: { id: true, madeById: true, listing: { select: { title: true } }, buyerId: true, sellerId: true } });
  if (!stale.length) return 0;
  await prisma.offer.updateMany({ where: { id: { in: stale.map((o) => o.id) } }, data: { status: "EXPIRED", respondedAt: new Date() } });
  return stale.length;
}

type Actor = "buyer" | "seller";

async function postOfferMessage(conversationId: string, senderId: string, offerId: string, body: string, recipientId: string, link: string, title: string, kind: "OFFER" | "SYSTEM" = "OFFER") {
  await prisma.$transaction([
    prisma.message.create({ data: { conversationId, senderId, kind, offerId, body } }),
    prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date(), archivedByA: false, archivedByB: false }, select: { id: true } }),
    prisma.notification.create({ data: { userId: recipientId, type: kind === "SYSTEM" ? "OFFER_UPDATED" : "OFFER_RECEIVED", title, body, link } }),
  ]);
}

export type OfferResult = { ok: true; offerId: string } | { ok: false; status: number; error: string };

export async function createOffer(params: { conversationId: string; userId: string; amountCents: number }): Promise<OfferResult> {
  const conversation = await prisma.conversation.findUnique({ where: { id: params.conversationId }, include: { listing: true } });
  if (!conversation || (conversation.userAId !== params.userId && conversation.userBId !== params.userId)) return { ok: false, status: 404, error: "Conversation not found" };
  const listing = conversation.listing;
  if (!listing) return { ok: false, status: 400, error: "Offers can only be made on a listing." };
  if (listing.sellerId === params.userId) return { ok: false, status: 403, error: "Sellers respond to offers; use Counter offer instead." };
  if (listing.status !== "ACTIVE") return { ok: false, status: 409, error: "This listing is no longer available." };
  if (params.amountCents <= 0) return { ok: false, status: 400, error: "Enter an offer amount greater than zero." };
  if (params.amountCents > listing.priceCents * 2) return { ok: false, status: 400, error: "That offer is far above the asking price. Check the amount." };
  await expireStaleOffers({ conversationId: conversation.id });
  const open = await prisma.offer.findFirst({ where: { conversationId: conversation.id, status: { in: ["PENDING", "ACCEPTED"] } }, select: { id: true } });
  if (open) return { ok: false, status: 409, error: "There is already an open offer in this conversation." };
  const offer = await prisma.offer.create({ data: { listingId: listing.id, conversationId: conversation.id, buyerId: params.userId, sellerId: listing.sellerId, madeById: params.userId, amountCents: params.amountCents, expiresAt: new Date(Date.now() + OFFER_TTL_MS) } });
  await postOfferMessage(conversation.id, params.userId, offer.id, `Offer: ${formatZAR(offer.amountCents)} for ${listing.title}`, listing.sellerId, `/messages/${conversation.id}`, "New offer received");
  return { ok: true, offerId: offer.id };
}

export type OfferAction = "ACCEPT" | "DECLINE" | "COUNTER" | "CANCEL" | "COMPLETE";

export async function actOnOffer(params: { offerId: string; userId: string; action: OfferAction; amountCents?: number }): Promise<OfferResult> {
  const offer = await prisma.offer.findUnique({ where: { id: params.offerId }, include: { listing: true } });
  if (!offer || (offer.buyerId !== params.userId && offer.sellerId !== params.userId)) return { ok: false, status: 404, error: "Offer not found" };
  const actor: Actor = offer.sellerId === params.userId ? "seller" : "buyer";
  const other = actor === "seller" ? offer.buyerId : offer.sellerId;
  const link = `/messages/${offer.conversationId}`;
  const now = new Date();

  if (offer.status === "PENDING" && offer.expiresAt <= now) {
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "EXPIRED", respondedAt: now } });
    return { ok: false, status: 409, error: "This offer has expired." };
  }

  const note = (body: string) => postOfferMessage(offer.conversationId, params.userId, offer.id, body, other, link, "Offer update", "SYSTEM");

  if (params.action === "CANCEL") {
    if (offer.madeById !== params.userId || offer.status !== "PENDING") return { ok: false, status: 409, error: "Only your own pending offer can be withdrawn." };
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "CANCELLED", respondedAt: now } });
    await note(`Offer of ${formatZAR(offer.amountCents)} was withdrawn.`);
    return { ok: true, offerId: offer.id };
  }

  if (params.action === "COMPLETE") {
    if (actor !== "seller" || offer.status !== "ACCEPTED") return { ok: false, status: 409, error: "Only the seller can complete an accepted offer." };
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "COMPLETED", completedAt: now } });
    await note(`The seller confirmed the sale at ${formatZAR(offer.amountCents)}.`);
    await evaluateAchievements(offer.sellerId).catch(() => null);
    return { ok: true, offerId: offer.id };
  }

  // ACCEPT, DECLINE and COUNTER respond to an offer made by the other party.
  if (offer.madeById === params.userId) return { ok: false, status: 403, error: "You cannot respond to your own offer." };
  if (offer.status !== "PENDING") return { ok: false, status: 409, error: "This offer is no longer open." };

  if (params.action === "ACCEPT") {
    if (offer.listing.status !== "ACTIVE") return { ok: false, status: 409, error: "This listing is no longer available." };
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "ACCEPTED", respondedAt: now } });
    await note(`Offer of ${formatZAR(offer.amountCents)} was accepted. Arrange payment and handover inside Vera Market.`);
    return { ok: true, offerId: offer.id };
  }
  if (params.action === "DECLINE") {
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "DECLINED", respondedAt: now } });
    await note(`Offer of ${formatZAR(offer.amountCents)} was declined.`);
    return { ok: true, offerId: offer.id };
  }
  if (!params.amountCents || params.amountCents <= 0) return { ok: false, status: 400, error: "Enter a counter amount greater than zero." };
  if (params.amountCents > offer.listing.priceCents * 2) return { ok: false, status: 400, error: "That amount is far above the asking price." };
  const counter = await prisma.$transaction(async (tx) => {
    await tx.offer.update({ where: { id: offer.id }, data: { status: "COUNTERED", respondedAt: now } });
    return tx.offer.create({ data: { listingId: offer.listingId, conversationId: offer.conversationId, buyerId: offer.buyerId, sellerId: offer.sellerId, madeById: params.userId, amountCents: params.amountCents!, parentOfferId: offer.id, expiresAt: new Date(Date.now() + OFFER_TTL_MS) } });
  });
  await postOfferMessage(offer.conversationId, params.userId, counter.id, `Counter offer: ${formatZAR(counter.amountCents)} for ${offer.listing.title}`, other, link, "Counter offer received");
  return { ok: true, offerId: counter.id };
}