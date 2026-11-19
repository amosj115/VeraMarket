import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { evaluateAchievements } from "@/lib/achievements";

export const OFFER_TTL_MS = 48 * 60 * 60 * 1000;

export async function expireStaleOffers(where: { conversationId?: string; listingId?: string } = {}) {
  const stale = await prisma.offer.findMany({ where: { ...where, status: "PENDING", expiresAt: { lte: new Date() } }, select: { id: true, madeById: true, listing: { select: { title: true } }, buyerId: true, sellerId: true } });
  if (!stale.length) return 0;
  const now = new Date();
  const expired = await prisma.offer.updateMany({
    where: { id: { in: stale.map((o) => o.id) }, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", respondedAt: now },
  });
  return expired.count;
}

type Actor = "buyer" | "seller";

type OfferMessageInput = {
  conversationId: string;
  senderId: string;
  offerId: string;
  body: string;
  recipientId: string;
  link: string;
  title: string;
  kind?: "OFFER" | "SYSTEM";
  visibleToId?: string;
};

async function writeOfferMessage(tx: Prisma.TransactionClient, input: OfferMessageInput) {
  const kind = input.kind ?? "OFFER";
  await tx.message.create({
    data: {
      conversationId: input.conversationId,
      senderId: input.senderId,
      kind,
      offerId: input.offerId,
      body: input.body,
      visibleToId: input.visibleToId,
    },
  });
  await tx.conversation.update({
    where: { id: input.conversationId },
    data: { updatedAt: new Date(), archivedByA: false, archivedByB: false },
    select: { id: true },
  });
  await tx.notification.create({
    data: {
      userId: input.recipientId,
      type: kind === "SYSTEM" ? "OFFER_UPDATED" : "OFFER_RECEIVED",
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });
}

async function postOfferMessage(input: OfferMessageInput) {
  await prisma.$transaction((tx) => writeOfferMessage(tx, input));
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
  await postOfferMessage({
    conversationId: conversation.id,
    senderId: params.userId,
    offerId: offer.id,
    body: `Offer: ${formatZAR(offer.amountCents)} for ${listing.title}`,
    recipientId: listing.sellerId,
    link: `/messages/${conversation.id}`,
    title: "New offer received",
  });
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
    const expired = await prisma.offer.updateMany({
      where: { id: offer.id, status: "PENDING", expiresAt: { lte: now } },
      data: { status: "EXPIRED", respondedAt: now },
    });
    if (expired.count === 1) return { ok: false, status: 409, error: "This offer has expired." };
    const current = await prisma.offer.findUnique({ where: { id: offer.id }, select: { status: true } });
    return {
      ok: false,
      status: 409,
      error: current?.status === "EXPIRED" ? "This offer has expired." : "This offer is no longer open.",
    };
  }

  const note = (tx: Prisma.TransactionClient, body: string) =>
    writeOfferMessage(tx, {
      conversationId: offer.conversationId,
      senderId: params.userId,
      offerId: offer.id,
      body,
      recipientId: other,
      link,
      title: "Offer update",
      kind: "SYSTEM",
    });

  if (params.action === "CANCEL") {
    if (offer.madeById !== params.userId || offer.status !== "PENDING") return { ok: false, status: 409, error: "Only your own pending offer can be withdrawn." };
    const cancelled = await prisma.$transaction(async (tx) => {
      const updated = await tx.offer.updateMany({
        where: { id: offer.id, madeById: params.userId, status: "PENDING" },
        data: { status: "CANCELLED", respondedAt: now },
      });
      if (updated.count !== 1) return false;
      await note(tx, `Offer of ${formatZAR(offer.amountCents)} was withdrawn.`);
      return true;
    });
    if (!cancelled) return { ok: false, status: 409, error: "This offer is no longer open." };
    return { ok: true, offerId: offer.id };
  }

  if (params.action === "COMPLETE") {
    if (actor !== "seller" || offer.status !== "ACCEPTED") return { ok: false, status: 409, error: "Only the seller can complete an accepted offer." };
    const completed = await prisma.$transaction(async (tx) => {
      const updated = await tx.offer.updateMany({
        where: { id: offer.id, sellerId: params.userId, status: "ACCEPTED" },
        data: { status: "COMPLETED", completedAt: now },
      });
      if (updated.count !== 1) return false;
      await note(tx, `The seller confirmed the sale at ${formatZAR(offer.amountCents)}.`);
      return true;
    });
    if (!completed) return { ok: false, status: 409, error: "This offer is no longer open." };
    await evaluateAchievements(offer.sellerId).catch(() => null);
    return { ok: true, offerId: offer.id };
  }

  // ACCEPT, DECLINE and COUNTER respond to an offer made by the other party.
  if (offer.madeById === params.userId) return { ok: false, status: 403, error: "You cannot respond to your own offer." };
  if (offer.status !== "PENDING") return { ok: false, status: 409, error: "This offer is no longer open." };

  if (params.action === "ACCEPT") {
    if (offer.listing.status !== "ACTIVE") return { ok: false, status: 409, error: "This listing is no longer available." };
    const acceptedBody = `🎉 Offer accepted! The seller has accepted your offer of ${formatZAR(offer.amountCents)}. Contact the seller through Vera Market chat to arrange a safe meetup, inspect the item, and agree on payment and collection directly with the seller. Remember, Vera Market does not process payments or handle physical exchanges.`;
    const accepted = await prisma.$transaction(async (tx) => {
      const updated = await tx.offer.updateMany({
        where: { id: offer.id, status: "PENDING" },
        data: { status: "ACCEPTED", respondedAt: now },
      });
      if (updated.count !== 1) return false;
      await writeOfferMessage(tx, {
        conversationId: offer.conversationId,
        senderId: params.userId,
        offerId: offer.id,
        body: acceptedBody,
        recipientId: offer.buyerId,
        link,
        title: "Offer update",
        kind: "SYSTEM",
        visibleToId: offer.buyerId,
      });
      return true;
    });
    if (!accepted) return { ok: false, status: 409, error: "This offer is no longer open." };
    return { ok: true, offerId: offer.id };
  }
  if (params.action === "DECLINE") {
    const declined = await prisma.$transaction(async (tx) => {
      const updated = await tx.offer.updateMany({
        where: { id: offer.id, status: "PENDING" },
        data: { status: "DECLINED", respondedAt: now },
      });
      if (updated.count !== 1) return false;
      await note(tx, `Offer of ${formatZAR(offer.amountCents)} was declined.`);
      return true;
    });
    if (!declined) return { ok: false, status: 409, error: "This offer is no longer open." };
    return { ok: true, offerId: offer.id };
  }
  if (!params.amountCents || params.amountCents <= 0) return { ok: false, status: 400, error: "Enter a counter amount greater than zero." };
  if (params.amountCents > offer.listing.priceCents * 2) return { ok: false, status: 400, error: "That amount is far above the asking price." };
  const counter = await prisma.$transaction(async (tx) => {
    const updated = await tx.offer.updateMany({
      where: { id: offer.id, status: "PENDING" },
      data: { status: "COUNTERED", respondedAt: now },
    });
    if (updated.count !== 1) return null;
    const created = await tx.offer.create({
      data: {
        listingId: offer.listingId,
        conversationId: offer.conversationId,
        buyerId: offer.buyerId,
        sellerId: offer.sellerId,
        madeById: params.userId,
        amountCents: params.amountCents!,
        parentOfferId: offer.id,
        expiresAt: new Date(Date.now() + OFFER_TTL_MS),
      },
    });
    await writeOfferMessage(tx, {
      conversationId: offer.conversationId,
      senderId: params.userId,
      offerId: created.id,
      body: `Counter offer: ${formatZAR(created.amountCents)} for ${offer.listing.title}`,
      recipientId: other,
      link,
      title: "Counter offer received",
    });
    return created;
  });
  if (!counter) return { ok: false, status: 409, error: "This offer is no longer open." };
  return { ok: true, offerId: counter.id };
}