import { prisma } from "@/lib/prisma";
import type { ShareTarget } from "@/lib/share";

// Resolves the owner of public, active content. Returns null for anything that isn't publicly visible.
export async function resolveShareTarget(type: ShareTarget, id: string): Promise<{ ownerId: string } | null> {
  switch (type) {
    case "LISTING": {
      const row = await prisma.listing.findFirst({ where: { id, status: "ACTIVE" }, select: { sellerId: true } });
      return row ? { ownerId: row.sellerId } : null;
    }
    case "SHOP": {
      const row = await prisma.shop.findFirst({ where: { id, status: "ACTIVE", isPaused: false }, select: { ownerId: true } });
      return row ? { ownerId: row.ownerId } : null;
    }
    case "SERVICE": {
      const row = await prisma.serviceListing.findFirst({ where: { id, status: "ACTIVE" }, select: { providerId: true } });
      return row ? { ownerId: row.providerId } : null;
    }
    case "PROPERTY": {
      const row = await prisma.propertyListing.findFirst({ where: { id, status: "ACTIVE" }, select: { ownerId: true } });
      return row ? { ownerId: row.ownerId } : null;
    }
    case "PROFILE": {
      const row = await prisma.user.findFirst({ where: { id, status: "ACTIVE" }, select: { id: true } });
      return row ? { ownerId: row.id } : null;
    }
  }
}

export async function recordShareChat(type: ShareTarget, id: string, userId: string) {
  const target = await resolveShareTarget(type, id);
  if (!target || target.ownerId === userId) return;
  const recent = await prisma.shareEvent.findFirst({ where: { targetType: type, targetId: id, kind: "CHAT", userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, select: { id: true } });
  if (recent) return;
  await prisma.shareEvent.create({ data: { targetType: type, targetId: id, ownerId: target.ownerId, kind: "CHAT", userId } });
}