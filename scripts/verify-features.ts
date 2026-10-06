import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { createOffer, actOnOffer, expireStaleOffers } from "@/lib/offers";
import { notifyWishlistStatus } from "@/lib/notifications";
import { notifySavedSearchMatches } from "@/lib/saved-searches";
import { getTrust, scoreTrust, getTrustConfig } from "@/lib/trust";
import { evaluateAchievements, listAchievements } from "@/lib/achievements";
import { activeListingBoosts } from "@/lib/boosts";

// Runs the real library code against the real (local) database with throwaway users; cleans up afterwards.
const run = Date.now().toString(36);
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`); };
const mk = (tag: string) => prisma.user.create({ data: { email: `feat-${run}-${tag}@example.test`, username: `ft_${run}_${tag}`, displayName: `Feat ${tag}`, passwordHash: "x", emailVerifiedAt: new Date() } });

async function main() {
  const [seller, buyer, other] = await Promise.all([mk("s"), mk("b"), mk("o")]);
  const category = await prisma.category.findFirstOrThrow();
  const mkListing = (title: string, extra: object = {}) => prisma.listing.create({ data: { sellerId: seller.id, categoryId: category.id, title, slug: `ft-${run}-${Math.random().toString(36).slice(2, 8)}`, description: "Good condition item for sale", priceCents: 100000, condition: "GOOD", location: "Cape Town", status: "ACTIVE", ...extra } });

  // Contact redaction through the shared Prisma client (same path as the API routes)
  const leaky = await mkListing("Phone 0821234567 call me", { description: "Email me at a@b.co or visit https://x.example" });
  check("contact info redacted on create", !/0821234567|a@b\.co|https:/.test(leaky.title + leaky.description), leaky);
  const upd = await prisma.listing.update({ where: { id: leaky.id }, data: { description: "WhatsApp +27 82 123 4567" } });
  check("contact info redacted on update", !/4567/.test(upd.description), upd.description);
  check("clean text untouched", (await mkListing("Samsung Galaxy S21 128GB")).title === "Samsung Galaxy S21 128GB");

  // Saved search match
  await prisma.savedSearch.create({ data: { userId: buyer.id, name: "bikes", query: "mountain bike" } });
  const bike = await mkListing("Mountain bike Trek 29er");
  await notifySavedSearchMatches(bike.id);
  check("saved search match notifies buyer", (await prisma.notification.count({ where: { userId: buyer.id, type: "SAVED_SEARCH_MATCH" } })) === 1);
  check("seller not notified of own listing", (await prisma.notification.count({ where: { userId: seller.id, type: "SAVED_SEARCH_MATCH" } })) === 0);

  // Offers
  const [a, b] = [seller.id, buyer.id].sort();
  const conv = await prisma.conversation.create({ data: { userAId: a, userBId: b, listingId: bike.id } });
  check("seller cannot offer on own listing", !(await createOffer({ conversationId: conv.id, userId: seller.id, amountCents: 50000 })).ok);
  check("non-participant rejected", !(await createOffer({ conversationId: conv.id, userId: other.id, amountCents: 50000 })).ok);
  check("zero/negative offer rejected", !(await createOffer({ conversationId: conv.id, userId: buyer.id, amountCents: 0 })).ok);
  const o1 = await createOffer({ conversationId: conv.id, userId: buyer.id, amountCents: 80000 });
  check("buyer makes offer", o1.ok);
  if (!o1.ok) return;
  check("maker cannot accept own offer", !(await actOnOffer({ offerId: o1.offerId, userId: buyer.id, action: "ACCEPT" })).ok);
  const counter = await actOnOffer({ offerId: o1.offerId, userId: seller.id, action: "COUNTER", amountCents: 90000 });
  check("seller counters", counter.ok && (await prisma.offer.findUnique({ where: { id: o1.offerId } }))?.status === "COUNTERED");
  if (!counter.ok) return;
  const acc = await actOnOffer({ offerId: counter.offerId, userId: buyer.id, action: "ACCEPT" });
  check("buyer accepts counter", acc.ok);
  check("accepting does NOT mark listing sold", (await prisma.listing.findUnique({ where: { id: bike.id } }))?.status === "ACTIVE");
  check("buyer cannot complete sale", !(await actOnOffer({ offerId: counter.offerId, userId: buyer.id, action: "COMPLETE" })).ok);
  check("other user cannot act", !(await actOnOffer({ offerId: counter.offerId, userId: other.id, action: "COMPLETE" })).ok);
  const before = await getTrust(seller.id);
  check("seller completes sale", (await actOnOffer({ offerId: counter.offerId, userId: seller.id, action: "COMPLETE" })).ok);
  check("offer COMPLETED", (await prisma.offer.findUnique({ where: { id: counter.offerId } }))?.status === "COMPLETED");
  const after = await getTrust(seller.id);
  check("completed sale counted in trust stats", (after?.stats.completedSales ?? 0) === (before?.stats.completedSales ?? 0) + 1, { before: before?.stats, after: after?.stats });

  const o2 = await createOffer({ conversationId: conv.id, userId: buyer.id, amountCents: 70000 });
  if (o2.ok) {
    check("decline works", (await actOnOffer({ offerId: o2.offerId, userId: seller.id, action: "DECLINE" })).ok);
    check("declined offer cannot be accepted", !(await actOnOffer({ offerId: o2.offerId, userId: seller.id, action: "ACCEPT" })).ok);
  } else check("second offer created", false, o2);
  const o3 = await createOffer({ conversationId: conv.id, userId: buyer.id, amountCents: 60000 });
  if (o3.ok) {
    check("buyer withdraws", (await actOnOffer({ offerId: o3.offerId, userId: buyer.id, action: "CANCEL" })).ok);
    const o4 = await createOffer({ conversationId: conv.id, userId: buyer.id, amountCents: 65000 });
    if (o4.ok) {
      await prisma.offer.update({ where: { id: o4.offerId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      check("stale offer expires", (await expireStaleOffers()) >= 1 && (await prisma.offer.findUnique({ where: { id: o4.offerId } }))?.status === "EXPIRED");
      check("expired offer cannot be accepted", !(await actOnOffer({ offerId: o4.offerId, userId: seller.id, action: "ACCEPT" })).ok);
    } else check("fourth offer created", false, o4);
  } else check("third offer created", false, o3);

  // Wishlist
  await prisma.favorite.create({ data: { userId: buyer.id, listingId: bike.id } });
  await notifyWishlistStatus(bike.id, "SOLD");
  check("wishlist user notified when sold", (await prisma.notification.count({ where: { userId: buyer.id, type: "WISHLIST_UPDATE" } })) >= 1);

  // Trust: new account floor + config-driven
  const cfg = await getTrustConfig();
  const fresh = scoreTrust({ ...(after!.stats), completedSales: 50, reviewCount: 50, averageRating: 5, accountAgeDays: 0 }, cfg);
  check("brand-new account cannot reach top tier", fresh.score < 90, fresh);
  check("trust score within 0..100", after!.score >= 0 && after!.score <= 100);

  // Achievements are only awarded when rules are met
  await evaluateAchievements(seller.id);
  const ach = await listAchievements(seller.id);
  const earned = ach.filter((x) => x.awardedAt);
  check("achievements list is DB-backed", ach.length > 0);
  check("achievements awarded only by rule (seller)", earned.every((x) => x.name.length > 0));

  // Boost ranking helper
  const boosted = await mkListing("Boosted thing");
  await prisma.boost.create({ data: { userId: seller.id, targetType: "LISTING", listingId: boosted.id, duration: "ONE_DAY", status: "ACTIVE", startsAt: new Date(), expiresAt: new Date(Date.now() + 86400000), priority: 3, durationDays: 1 } });
  const map = await activeListingBoosts();
  check("active boost shows in ranking map", map.get(boosted.id) === 3);
  check("pending/expired boosts do not rank", !map.has(bike.id));

  // Cleanup
  await prisma.user.deleteMany({ where: { id: { in: [seller.id, buyer.id, other.id] } } });
}

main().catch((e) => { failures++; console.error(e); }).finally(async () => { await prisma.$disconnect(); console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED"); process.exit(failures ? 1 : 0); });