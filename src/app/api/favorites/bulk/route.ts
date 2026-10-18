import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { publicListingWhere } from "@/lib/listing-visibility";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ids: [] });
  }

  const favorites = await prisma.favorite.findMany({
    where: {
      userId: session.user.id,
      listing: { is: publicListingWhere() },
    },
    select: { listingId: true },
  });

  return NextResponse.json({ ids: favorites.map((f) => f.listingId) });
}
