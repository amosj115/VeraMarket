import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const requestedDomain =
    request.nextUrl.searchParams.get("domain") ?? "MARKETPLACE";
  const domain = (
    ["MARKETPLACE", "SHOP", "SERVICE", "REAL_ESTATE"] as const
  ).find((candidate) => candidate === requestedDomain);

  if (!domain) {
    return NextResponse.json({ error: "Invalid category domain" }, { status: 400 });
  }

  const categories = await prisma.category.findMany({
    where: {
      domain,
      isEnabled: true,
    },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, slug: true },
  });

  return NextResponse.json({ categories });
}
