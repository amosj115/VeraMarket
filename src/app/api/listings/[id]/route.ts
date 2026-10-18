import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { listingUpdateSchema } from "@/lib/validation/listing-update";
import { dropListingMatchNotifications, notifyPriceChange, notifyWishlistStatus, safeNotify } from "@/lib/notifications";
import { enforceReviewStatus } from "@/lib/review-enforcement";
import { lockAccountForContentLifecycle, removeOwnedListing } from "@/lib/account-lifecycle";

async function ownedListing(id: string, userId: string) { return prisma.listing.findFirst({ where: { id, sellerId: userId } }); }

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  const review = enforceReviewStatus(user);
  if (review.isBlocked) return review.response;

  const parsed = listingUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid update" }, { status: 400 });
  const { priceRand, ...rest } = parsed.data;
  let existing;
  let listing;
  if (rest.status !== undefined) {
    const result = await prisma.$transaction(async (tx) => {
      await lockAccountForContentLifecycle(tx, session.user.id);
      const currentUser = await tx.user.findUnique({ where: { id: session.user.id }, select: { status: true, flaggedForReview: true } });
      if (currentUser?.status !== "ACTIVE") return { kind: "account-ineligible" as const };
      if (currentUser.flaggedForReview) return { kind: "review-blocked" as const };
      const currentListing = await tx.listing.findFirst({ where: { id, sellerId: session.user.id }, select: { id: true, priceCents: true, status: true } });
      if (!currentListing) return { kind: "not-found" as const };
      if (rest.status === "REMOVED") {
        const removal = await removeOwnedListing(tx, session.user.id, id);
        if (removal !== "removed") return { kind: removal };
        const updateData = { ...rest, ...(priceRand === undefined ? {} : { priceCents: Math.round(priceRand * 100) }) };
        delete updateData.status;
        const updatedListing = Object.keys(updateData).length === 0
          ? await tx.listing.findUnique({ where: { id }, select: { id: true, slug: true, status: true, priceCents: true } })
          : await tx.listing.update({ where: { id }, data: updateData, select: { id: true, slug: true, status: true, priceCents: true } });
        if (!updatedListing) return { kind: "conflict" as const };
        return { kind: "updated" as const, existing: currentListing, listing: updatedListing };
      }
      const updatedListing = await tx.listing.update({ where: { id }, data: { ...rest, ...(priceRand === undefined ? {} : { priceCents: Math.round(priceRand * 100) }) }, select: { id: true, slug: true, status: true, priceCents: true } });
      return { kind: "updated" as const, existing: currentListing, listing: updatedListing };
    }, { isolationLevel: "ReadCommitted" });
    if (result.kind === "account-ineligible") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (result.kind === "review-blocked") return NextResponse.json({ error: "Your account is currently under review. You cannot create or publish new content at this time. Please contact support if you believe this is an error." }, { status: 403 });
    if (result.kind === "not-found") return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    if (result.kind === "conflict") return NextResponse.json({ error: "This listing changed while it was being removed. Reload and try again." }, { status: 409 });
    if (result.kind !== "updated") return NextResponse.json({ error: "This listing changed while it was being removed. Reload and try again." }, { status: 409 });
    existing = result.existing;
    listing = result.listing;
  } else {
    existing = await ownedListing(id, session.user.id);
    if (!existing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    listing = await prisma.listing.update({ where: { id }, data: { ...rest, ...(priceRand === undefined ? {} : { priceCents: Math.round(priceRand * 100) }) }, select: { id: true, slug: true, status: true, priceCents: true } });
  }
  if (listing.priceCents !== existing.priceCents) await safeNotify(() => notifyPriceChange(listing.id, existing.priceCents, listing.priceCents));
  if (listing.status !== existing.status) {
    // The listing left the public catalogue: stop match notifications from still
    // promising it as "just listed". Event history (followers, price, wishlist) stays.
    await safeNotify(() => dropListingMatchNotifications(id));
    if (listing.status === "SOLD" || listing.status === "REMOVED") await safeNotify(() => notifyWishlistStatus(listing.id, listing.status as "SOLD" | "REMOVED"));
  }
  return NextResponse.json({ listing: { id: listing.id, slug: listing.slug, status: listing.status } });
}


export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await prisma.$transaction((tx) => removeOwnedListing(tx, session.user.id, id), { isolationLevel: "ReadCommitted" });
  if (result === "account-ineligible") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (result === "not-found") return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (result === "conflict") return NextResponse.json({ error: "This listing changed while it was being removed. Reload and try again." }, { status: 409 });
  await safeNotify(() => notifyWishlistStatus(id, "REMOVED"));
  await safeNotify(() => dropListingMatchNotifications(id));
  return NextResponse.json({ removed: true });
}
