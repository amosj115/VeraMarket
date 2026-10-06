import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTrendingPage } from "@/lib/trending";

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

  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { trendingNotificationsEnabled: true },
    });
    if (user?.trendingNotificationsEnabled) {
      const page = await getTrendingPage(session.user.id);
      const matchingTrend = page.items.some((item) =>
        item.labels.some((label) => label === "Trending now" || label === "Rising fast") &&
        item.labels.some((label) => label.startsWith("Because you searched for "))
      );
      if (matchingTrend) {
        const recentNotification = await prisma.notification.findFirst({
          where: { userId: session.user.id, type: "TRENDING_MATCH", createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          select: { id: true },
        });
        if (!recentNotification) {
          await prisma.notification.create({
            data: {
              userId: session.user.id,
              type: "TRENDING_MATCH",
              title: "New listings are trending",
              body: "Listings matching your interests are gaining attention.",
              link: "/trending",
            },
          });
        }
      }
    }
  }
  return NextResponse.json({ recorded: true });
}