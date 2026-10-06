export type ShareTarget = "SHOP" | "LISTING" | "SERVICE" | "PROPERTY" | "PROFILE";

// Permanent public paths. Slugs are generated once and never change, so renaming a shop or listing keeps old links working.
export function publicPath(target: ShareTarget, slug: string): string {
  switch (target) {
    case "SHOP": return `/shop/${slug}`;
    case "LISTING": return `/listing/${slug}`;
    case "SERVICE": return `/services/${slug}`;
    case "PROPERTY": return `/real-estate/${slug}`;
    case "PROFILE": return `/@${slug}`;
  }
}

export function publicUrl(origin: string, target: ShareTarget, slug: string): string {
  return `${origin.replace(/\/+$/, "")}${publicPath(target, slug)}`;
}

// Marks a link as shared so visits can be counted. Stripped from the canonical URL.
export function sharedUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}src=share`;
}

export function defaultShareMessage(target: ShareTarget, url: string, title?: string): string {
  switch (target) {
    case "SHOP": return `Check out my Virtual Shop on Vera Market 🛍️\nI have great products available.\nView my shop: ${url}`;
    case "LISTING": return `I'm selling this on Vera Market 👀\nCheck it out here: ${url}`;
    case "SERVICE": return `I offer ${title ? `"${title}"` : "this service"} on Vera Market.\nTake a look: ${url}`;
    case "PROPERTY": return `Take a look at this property on Vera Market 🏠\n${url}`;
    case "PROFILE": return `Visit my profile on Vera Market:\n${url}`;
  }
}

export const SHARE_CHANNELS = ["whatsapp", "facebook", "x", "telegram", "email", "copy", "native"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export function channelHref(channel: Exclude<ShareChannel, "copy" | "native">, message: string, url: string, subject: string): string {
  const text = encodeURIComponent(message);
  switch (channel) {
    case "whatsapp": return `https://wa.me/?text=${text}`;
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${text}`;
    case "x": return `https://twitter.com/intent/tweet?text=${encodeURIComponent(message.replace(url, "").trim())}&url=${encodeURIComponent(url)}`;
    case "telegram": return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message.replace(url, "").trim())}`;
    case "email": return `mailto:?subject=${encodeURIComponent(subject)}&body=${text}`;
  }
}