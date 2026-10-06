import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain") ?? "MARKETPLACE";

  const categories = await prisma.category.findMany({
    where: {
      domain: domain as "MARKETPLACE" | "SHOP" | "SERVICE" | "REAL_ESTATE",
      isEnabled: true,
    },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, slug: true },
  });

  return NextResponse.json({ categories });
}
