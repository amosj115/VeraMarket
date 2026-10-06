import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/app-url";
import { formatZAR } from "@/lib/utils";
import { publicPath, type ShareTarget } from "@/lib/share";

export type ShareCard = {
  target: ShareTarget;
  title: string;
  description: string;
  priceLabel: string | null;
  imageUrl: string | null;
  byline: string;
  path: string;
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
export const absolute = (url: string | null | undefined) => (!url ? null : /^https?:\/\//i.test(url) ? url : `${appUrl()}${url.startsWith("/") ? "" : "/"}${url}`);

// Public-safe data only: never owner email, phone or address.
export async function getShareCard(target: Exclude<ShareTarget, "PROFILE">, slug: string): Promise<ShareCard | null> {
  switch (target) {
    case "LISTING": {
      const row = await prisma.listing.findUnique({ where: { slug }, select: { title: true, description: true, priceCents: true, status: true, location: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } }, seller: { select: { displayName: true } } } });
      if (!row || row.status !== "ACTIVE") return null;
      return { target, title: row.title, description: clip(row.description.replace(/\s+/g, " "), 160), priceLabel: formatZAR(row.priceCents), imageUrl: absolute(row.images[0]?.url), byline: `${row.seller.displayName} · ${row.location}`, path: publicPath(target, slug) };
    }
    case "SHOP": {
      const row = await prisma.shop.findUnique({ where: { slug }, select: { name: true, description: true, status: true, isPaused: true, logoUrl: true, coverUrl: true, address: true, subscription: { select: { status: true } }, owner: { select: { displayName: true } } } });
      if (!row || row.status !== "ACTIVE" || row.isPaused || row.subscription?.status !== "ACTIVE") return null;
      return { target, title: row.name, description: clip(row.description.replace(/\s+/g, " "), 160), priceLabel: null, imageUrl: absolute(row.coverUrl ?? row.logoUrl), byline: `Virtual Shop by ${row.owner.displayName}`, path: publicPath(target, slug) };
    }
    case "SERVICE": {
      const row = await prisma.serviceListing.findUnique({ where: { slug }, select: { title: true, description: true, priceCents: true, status: true, location: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } }, provider: { select: { displayName: true } } } });
      if (!row || row.status !== "ACTIVE") return null;
      return { target, title: row.title, description: clip(row.description.replace(/\s+/g, " "), 160), priceLabel: row.priceCents ? `From ${formatZAR(row.priceCents)}` : null, imageUrl: absolute(row.images[0]?.url), byline: `${row.provider.displayName} · ${row.location}`, path: publicPath(target, slug) };
    }
    case "PROPERTY": {
      const row = await prisma.propertyListing.findUnique({ where: { slug }, select: { title: true, description: true, priceCents: true, status: true, location: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } }, owner: { select: { displayName: true } } } });
      if (!row || row.status !== "ACTIVE") return null;
      return { target, title: row.title, description: clip(row.description.replace(/\s+/g, " "), 160), priceLabel: formatZAR(row.priceCents), imageUrl: absolute(row.images[0]?.url), byline: `${row.owner.displayName} · ${row.location}`, path: publicPath(target, slug) };
    }
  }
}

export function ogImageUrl(target: ShareTarget, slug: string) {
  return `${appUrl()}/api/og?type=${target.toLowerCase()}&slug=${encodeURIComponent(slug)}`;
}

export function cardMetadata(card: ShareCard, slug: string): Metadata {
  const canonical = `${appUrl()}${card.path}`;
  const title = card.priceLabel ? `${card.title} – ${card.priceLabel}` : card.title;
  const images = [{ url: ogImageUrl(card.target, slug), width: 1200, height: 630, alt: card.title }];
  return {
    title,
    description: card.description,
    alternates: { canonical },
    openGraph: { type: "website", siteName: "Vera Market", url: canonical, title: `${title} | Vera Market`, description: card.description, images },
    twitter: { card: "summary_large_image", title: `${title} | Vera Market`, description: card.description, images: images.map((i) => i.url) },
  };
}

export const unavailableMetadata: Metadata = { title: "No longer available", robots: { index: false, follow: true } };