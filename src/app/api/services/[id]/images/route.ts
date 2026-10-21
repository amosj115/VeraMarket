import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { enforceReviewStatus } from "@/lib/review-enforcement";
import { IMAGE_MAX_BYTES, formatMegabytes, validateImageUpload } from "@/lib/security/image";
import { deleteStoredImage, putPublicImage, StorageError } from "@/lib/storage";
import {
  canAddServicePortfolioPhotos,
  SERVICE_PORTFOLIO_LIMIT,
  serviceListingOwnerWhere,
  servicePortfolioWhere,
} from "@/lib/service-gallery";

type RouteContext = { params: Promise<{ id: string }> };

const coverSelectionSchema = z.object({ imageId: z.string().cuid().nullable() });

async function reviewBlock(userId: string): Promise<NextResponse | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const review = enforceReviewStatus(user);
  if (!review.isBlocked) return null;
  return review.response ?? NextResponse.json({ error: "Your account cannot manage service photos at this time." }, { status: 403 });
}

async function ownedService(id: string, providerId: string) {
  return prisma.serviceListing.findFirst({
    where: serviceListingOwnerWhere(id, providerId),
    select: { id: true },
  });
}

async function lockOwnedService(tx: Prisma.TransactionClient, id: string, providerId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ServiceListing" WHERE "id" = ${id} AND "providerId" = ${providerId} FOR UPDATE`;
  return tx.serviceListing.findFirst({
    where: serviceListingOwnerWhere(id, providerId),
    select: { id: true, coverImageUrl: true },
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = await reviewBlock(session.user.id);
  if (blocked) return blocked;

  const { id } = await params;
  if (!(await ownedService(id, session.user.id))) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The upload didn't arrive correctly. Please try again." }, { status: 400 });
  const kind = form.get("kind");
  if (kind !== "cover" && kind !== "portfolio") {
    return NextResponse.json({ error: "Choose whether this is a cover or portfolio photo." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a photo to upload." }, { status: 400 });
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: `Photos must be ${formatMegabytes(IMAGE_MAX_BYTES)} or smaller.` },
      { status: 400 }
    );
  }

  if (kind === "portfolio") {
    const currentCount = await prisma.image.count({
      where: servicePortfolioWhere(id),
    });
    if (!canAddServicePortfolioPhotos(currentCount)) {
      return NextResponse.json(
        { error: `Your portfolio is full. You can upload up to ${SERVICE_PORTFOLIO_LIMIT} photos.` },
        { status: 409 }
      );
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "The photo could not be read. Please choose it again." }, { status: 400 });
  }
  const validation = validateImageUpload(bytes);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message, code: validation.code }, { status: 400 });
  }

  let url: string;
  try {
    url = await putPublicImage(bytes, validation.image.ext, validation.image.mime);
  } catch (error) {
    if (error instanceof StorageError) {
      return NextResponse.json({ error: error.message, code: `STORAGE_${error.code}` }, { status: 503 });
    }
    console.error("[service-photos] storage upload failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return NextResponse.json({ error: "The photo couldn't be saved. Please try again." }, { status: 500 });
  }

  try {
    if (kind === "cover") {
      const result = await prisma.$transaction(async (tx) => {
        const service = await lockOwnedService(tx, id, session.user.id);
        if (!service) return { kind: "not-found" as const };

        await tx.serviceListing.update({ where: { id }, data: { coverImageUrl: url } });
        const oldCoverIsPortfolio = service.coverImageUrl
          ? Boolean(await tx.image.findFirst({
              where: { ...servicePortfolioWhere(id), url: service.coverImageUrl },
              select: { id: true },
            }))
          : false;
        return { kind: "saved" as const, previousUrl: service.coverImageUrl, oldCoverIsPortfolio };
      });

      if (result.kind === "not-found") {
        await deleteStoredImage(url);
        return NextResponse.json({ error: "Service not found" }, { status: 404 });
      }
      if (result.previousUrl && result.previousUrl !== url && !result.oldCoverIsPortfolio) {
        await deleteStoredImage(result.previousUrl);
      }
      return NextResponse.json({ coverImageUrl: url }, { status: 201 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const service = await lockOwnedService(tx, id, session.user.id);
      if (!service) return { kind: "not-found" as const };

      const count = await tx.image.count({ where: servicePortfolioWhere(id) });
      if (!canAddServicePortfolioPhotos(count)) return { kind: "limit" as const };
      const lastImage = await tx.image.findFirst({
        where: servicePortfolioWhere(id),
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const image = await tx.image.create({
        data: {
          serviceId: id,
          ownerType: "SERVICE",
          url,
          sortOrder: (lastImage?.sortOrder ?? -1) + 1,
        },
        select: { id: true, url: true, sortOrder: true },
      });
      return { kind: "saved" as const, image };
    });

    if (result.kind !== "saved") {
      await deleteStoredImage(url);
      if (result.kind === "limit") {
        return NextResponse.json(
          { error: `Your portfolio is full. You can upload up to ${SERVICE_PORTFOLIO_LIMIT} photos.` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    return NextResponse.json({ image: result.image }, { status: 201 });
  } catch (error) {
    await deleteStoredImage(url);
    console.error("[service-photos] database update failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return NextResponse.json({ error: "The photo couldn't be added to this service. Please try again." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = await reviewBlock(session.user.id);
  if (blocked) return blocked;

  const { id } = await params;
  if (!(await ownedService(id, session.user.id))) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }
  const parsed = coverSelectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a portfolio photo or remove the cover." }, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    const service = await lockOwnedService(tx, id, session.user.id);
    if (!service) return { kind: "not-found" as const };
    const image = parsed.data.imageId
      ? await tx.image.findFirst({
          where: { id: parsed.data.imageId, ...servicePortfolioWhere(id) },
          select: { url: true },
        })
      : null;
    if (parsed.data.imageId && !image) return { kind: "image-not-found" as const };

    await tx.serviceListing.update({
      where: { id },
      data: { coverImageUrl: image?.url ?? null },
    });
    const oldCoverIsPortfolio =
      service.coverImageUrl && service.coverImageUrl !== image?.url
        ? Boolean(await tx.image.findFirst({
            where: { ...servicePortfolioWhere(id), url: service.coverImageUrl },
            select: { id: true },
          }))
        : false;
    return {
      kind: "saved" as const,
      coverImageUrl: image?.url ?? null,
      previousUrl: service.coverImageUrl,
      oldCoverIsPortfolio,
    };
  });

  if (result.kind === "not-found") return NextResponse.json({ error: "Service not found" }, { status: 404 });
  if (result.kind === "image-not-found") return NextResponse.json({ error: "Portfolio photo not found" }, { status: 404 });
  if (result.previousUrl && result.previousUrl !== result.coverImageUrl && !result.oldCoverIsPortfolio) {
    await deleteStoredImage(result.previousUrl);
  }
  return NextResponse.json({ coverImageUrl: result.coverImageUrl });
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = await reviewBlock(session.user.id);
  if (blocked) return blocked;

  const { id } = await params;
  if (!(await ownedService(id, session.user.id))) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }
  const imageId = request.nextUrl.searchParams.get("imageId");
  if (!imageId || !z.string().cuid().safeParse(imageId).success) {
    return NextResponse.json({ error: "A valid portfolio photo id is required." }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const service = await lockOwnedService(tx, id, session.user.id);
    if (!service) return { kind: "not-found" as const };
    const image = await tx.image.findFirst({
      where: { id: imageId, ...servicePortfolioWhere(id) },
      select: { id: true, url: true },
    });
    if (!image) return { kind: "image-not-found" as const };

    await tx.image.delete({ where: { id: image.id } });
    const sameImageStillInGallery = await tx.image.findFirst({
      where: { ...servicePortfolioWhere(id), url: image.url },
      select: { id: true },
    });
    return {
      kind: "removed" as const,
      url: image.url,
      stillUsed: service.coverImageUrl === image.url || Boolean(sameImageStillInGallery),
    };
  });

  if (result.kind === "not-found") return NextResponse.json({ error: "Service not found" }, { status: 404 });
  if (result.kind === "image-not-found") return NextResponse.json({ error: "Portfolio photo not found" }, { status: 404 });
  if (!result.stillUsed) await deleteStoredImage(result.url);
  return NextResponse.json({ removed: true });
}
