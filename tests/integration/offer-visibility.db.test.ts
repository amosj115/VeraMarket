import "../../scripts/test-db-env";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomBytes } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { actOnOffer, createOffer } from "../../src/lib/offers";

const run = randomBytes(4).toString("hex");
const userIds: string[] = [];
const categorySlug = `offer-vis-${run}`;
let categoryId = "";

async function makeUser(name: string) {
  const user = await prisma.user.create({
    data: {
      email: `${name}_${run}@example.test`,
      displayName: name,
      username: `${name}_${run}`,
      passwordHash: "x",
      emailVerifiedAt: new Date(),
      profileVerification: "VERIFIED",
    },
  });
  userIds.push(user.id);
  return user;
}

async function makeListing(sellerId: string, name: string) {
  return prisma.listing.create({
    data: {
      sellerId,
      categoryId,
      title: name,
      slug: `${name.toLowerCase().replaceAll(" ", "-")}-${run}`,
      description: "Offer visibility test listing",
      priceCents: 10_000_00,
      condition: "GOOD",
      location: "Test",
      status: "ACTIVE",
    },
  });
}

test.before(async () => {
  const category = await prisma.category.create({
    data: { domain: "MARKETPLACE", name: `Offer Visibility ${run}`, slug: categorySlug },
  });
  categoryId = category.id;
});

after(async () => {
  await prisma.offer.deleteMany({ where: { listing: { categoryId } } });
  await prisma.message.deleteMany({ where: { conversation: { listing: { categoryId } } } });
  await prisma.conversation.deleteMany({ where: { listing: { categoryId } } });
  await prisma.listing.deleteMany({ where: { categoryId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test("accepted offer is retrievable only by the buyer and cannot duplicate", async () => {
  const seller = await makeUser("seller");
  const buyer = await makeUser("buyer");
  const listing = await makeListing(seller.id, "Accepted Listing");
  const conversation = await prisma.conversation.create({
    data: { userAId: seller.id, userBId: buyer.id, listingId: listing.id },
  });
  const created = await createOffer({ conversationId: conversation.id, userId: buyer.id, amountCents: 9500_00 });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const accepted = await actOnOffer({ offerId: created.offerId, userId: seller.id, action: "ACCEPT" });
  assert.equal(accepted.ok, true);
  const duplicate = await actOnOffer({ offerId: created.offerId, userId: seller.id, action: "ACCEPT" });
  assert.equal(duplicate.ok, false);

  const buyerMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, OR: [{ visibleToId: null }, { visibleToId: buyer.id }] },
  });
  const sellerMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, OR: [{ visibleToId: null }, { visibleToId: seller.id }] },
  });
  const acceptance = (messages: typeof buyerMessages) => messages.filter((message) => message.body.includes("Offer accepted"));

  assert.equal(acceptance(buyerMessages).length, 1);
  assert.equal(acceptance(sellerMessages).length, 0);
  const refreshedBuyerMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, OR: [{ visibleToId: null }, { visibleToId: buyer.id }] },
  });
  assert.equal(acceptance(refreshedBuyerMessages).length, 1);
});

test("declined offers remain visible to both participants", async () => {
  const seller = await makeUser("decline_seller");
  const buyer = await makeUser("decline_buyer");
  const listing = await makeListing(seller.id, "Declined Listing");
  const conversation = await prisma.conversation.create({
    data: { userAId: seller.id, userBId: buyer.id, listingId: listing.id },
  });
  const created = await createOffer({ conversationId: conversation.id, userId: buyer.id, amountCents: 8500_00 });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const pendingMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, OR: [{ visibleToId: null }, { visibleToId: buyer.id }] },
  });
  assert.equal(pendingMessages.some((message) => message.body.includes("Offer accepted")), false);

  const declined = await actOnOffer({ offerId: created.offerId, userId: seller.id, action: "DECLINE" });
  assert.equal(declined.ok, true);
  const buyerMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, OR: [{ visibleToId: null }, { visibleToId: buyer.id }] },
  });
  const sellerMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, OR: [{ visibleToId: null }, { visibleToId: seller.id }] },
  });
  assert.ok(buyerMessages.some((message) => message.body.includes("declined")));
  assert.ok(sellerMessages.some((message) => message.body.includes("declined")));
});

test("ordinary buyer and seller messages remain visible to both participants", async () => {
  const seller = await makeUser("chat_seller");
  const buyer = await makeUser("chat_buyer");
  const listing = await makeListing(seller.id, "Chat Listing");
  const conversation = await prisma.conversation.create({
    data: { userAId: buyer.id, userBId: seller.id, listingId: listing.id },
  });

  await prisma.message.create({
    data: { conversationId: conversation.id, senderId: buyer.id, body: "Hi, is this item available?" },
  });
  await prisma.message.create({
    data: { conversationId: conversation.id, senderId: seller.id, body: "Yes, it is available." },
  });

  const buyerMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, OR: [{ visibleToId: null }, { visibleToId: buyer.id }] },
  });
  const sellerMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, OR: [{ visibleToId: null }, { visibleToId: seller.id }] },
  });
  assert.equal(buyerMessages.filter((message) => message.body.includes("available")).length, 2);
  assert.equal(sellerMessages.filter((message) => message.body.includes("available")).length, 2);
});

test("concurrent acceptance and decline produce one consistent offer outcome", async () => {
  const seller = await makeUser("race_seller");
  const buyer = await makeUser("race_buyer");
  const listing = await makeListing(seller.id, "Concurrent Offer Listing");
  const conversation = await prisma.conversation.create({
    data: { userAId: seller.id, userBId: buyer.id, listingId: listing.id },
  });
  const created = await createOffer({ conversationId: conversation.id, userId: buyer.id, amountCents: 9200_00 });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const [accepted, declined] = await Promise.all([
    actOnOffer({ offerId: created.offerId, userId: seller.id, action: "ACCEPT" }),
    actOnOffer({ offerId: created.offerId, userId: seller.id, action: "DECLINE" }),
  ]);
  assert.equal([accepted, declined].filter((result) => result.ok).length, 1);

  const offer = await prisma.offer.findUniqueOrThrow({ where: { id: created.offerId } });
  const messages = await prisma.message.findMany({ where: { conversationId: conversation.id } });
  const acceptMessages = messages.filter((message) => message.body.includes("Offer accepted"));
  const declineMessages = messages.filter((message) => message.body.includes("declined"));
  if (offer.status === "ACCEPTED") {
    assert.equal(acceptMessages.length, 1);
    assert.equal(declineMessages.length, 0);
    assert.equal(acceptMessages[0].visibleToId, buyer.id);
  } else {
    assert.equal(offer.status, "DECLINED");
    assert.equal(acceptMessages.length, 0);
    assert.equal(declineMessages.length, 1);
  }
});

test("accepted messages stay out of other buyers' conversations", async () => {
  const seller = await makeUser("multi_seller");
  const buyerOne = await makeUser("multi_buyer_one");
  const buyerTwo = await makeUser("multi_buyer_two");
  const listing = await makeListing(seller.id, "Multiple Buyers Listing");
  const anotherListing = await makeListing(seller.id, "Second Buyers Listing");

  const conversationOne = await prisma.conversation.create({
    data: { userAId: seller.id, userBId: buyerOne.id, listingId: listing.id },
  });
  const conversationTwo = await prisma.conversation.create({
    data: { userAId: seller.id, userBId: buyerTwo.id, listingId: anotherListing.id },
  });
  const createdOne = await createOffer({ conversationId: conversationOne.id, userId: buyerOne.id, amountCents: 9000_00 });
  const createdTwo = await createOffer({ conversationId: conversationTwo.id, userId: buyerTwo.id, amountCents: 8800_00 });
  assert.equal(createdOne.ok, true);
  assert.equal(createdTwo.ok, true);
  if (!createdOne.ok || !createdTwo.ok) return;

  assert.equal((await actOnOffer({ offerId: createdOne.offerId, userId: seller.id, action: "ACCEPT" })).ok, true);

  const buyerTwoMessages = await prisma.message.findMany({
    where: { conversationId: conversationTwo.id, OR: [{ visibleToId: null }, { visibleToId: buyerTwo.id }] },
  });
  assert.equal(buyerTwoMessages.filter((message) => message.body.includes("Offer accepted")).length, 0);
});
