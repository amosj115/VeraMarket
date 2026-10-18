import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireVerifiedProfile } from "@/lib/profile-gate";
import { enforceReviewStatus } from "@/lib/review-enforcement";
import { slugify } from "@/lib/utils";
import { createServiceSchema } from "@/lib/validation/service";
import { publicServiceWhere } from "@/lib/content-visibility";

export async function GET() {
  const services = await prisma.serviceListing.findMany({
    where: publicServiceWhere(),
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { category: true },
  });
  return NextResponse.json({ services });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  const review = enforceReviewStatus(user);
  if (review.isBlocked) return review.response;

  const blocked = await requireVerifiedProfile(session.user.id);
  if (blocked) return blocked;

  const parsed = createServiceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
  if (!category || category.domain !== "SERVICE") {
    return NextResponse.json({ error: "Invalid service category" }, { status: 400 });
  }

  const baseSlug = slugify(parsed.data.title);
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  const service = await prisma.serviceListing.create({
    data: {
      providerId: session.user.id,
      categoryId: parsed.data.categoryId,
      title: parsed.data.title,
      slug,
      description: parsed.data.description,
      pricingType: parsed.data.pricingType,
      priceCents: parsed.data.priceRand == null ? null : Math.round(parsed.data.priceRand * 100),
      serviceArea: parsed.data.serviceArea,
      location: parsed.data.location,
      status: "PENDING_REVIEW",
    },
    select: { id: true, slug: true, status: true },
  });

  return NextResponse.json({ service }, { status: 201 });
}
