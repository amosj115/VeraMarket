import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const searchSchema = z.object({
  query: z.string().trim().max(100).optional().default(""),
  categorySlug: z.string().trim().max(100).optional(),
}).refine((value) => value.query.length >= 3 || Boolean(value.categorySlug));

export async function POST(request: NextRequest) {
  const parsed = searchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ recorded: false }, { status: 400 });

  const session = await auth();
  const query = parsed.data.query
    ? parsed.data.query.replace(/\s+/g, " ").toLocaleLowerCase()
    : `category:${parsed.data.categorySlug}`;
  const categorySlug = parsed.data.categorySlug || null;
  const recentCutoff = new Date(Date.now() - 10 * 60 * 1000);
  const duplicate = await prisma.searchActivity.findFirst({
    where: {
      query,
      categorySlug,
      createdAt: { gte: recentCutoff },
      ...(session?.user ? { userId: session.user.id } : { userId: null }),
    },
    select: { id: true },
  });

  if (!duplicate) {
    await prisma.searchActivity.create({
      data: { query, categorySlug, userId: session?.user?.id },
    });
  }

  // Trending notifications are generated server-side on a schedule (see
  // /api/trending/notify), not when a user happens to search or visit the marketplace.
  return NextResponse.json({ recorded: true });
}