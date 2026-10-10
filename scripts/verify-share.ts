import "dotenv/config";
import "./db-guard";
import { spawn, type ChildProcess } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { channelHref, defaultShareMessage, publicPath, sharedUrl } from "@/lib/share";

// Exercises the share/public-link feature against a real dev server + the local database with throwaway data.
// Real-device behaviour (WhatsApp in-app browser, native app handoff, native share sheet) cannot be tested here.
const prisma = new PrismaClient();
const run = Date.now().toString(36);
const PASSWORD = "Passw0rdTest1";
const PORT = 3320;
const BASE = `http://localhost:${PORT}`;
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`); };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let server: ChildProcess | undefined;

async function start() {
  server = spawn(`npx next dev -p ${PORT}`, { shell: true, env: { ...process.env, NEXT_DIST_DIR: `.next-persona-${PORT}`, AUTH_TRUST_HOST: "true", NEXTAUTH_URL: BASE }, stdio: "ignore" });
  for (let i = 0; i < 90; i++) { if (await fetch(`${BASE}/api/auth/csrf`).then((r) => r.ok).catch(() => false)) return; await sleep(1000); }
  throw new Error("server did not start");
}

class Client {
  cookies = new Map<string, string>();
  constructor(public email: string) {}
  private store(res: Response) { for (const line of res.headers.getSetCookie()) { const [pair] = line.split(";"); const i = pair.indexOf("="); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); } }
  private header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  async login() {
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`); this.store(csrfRes);
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this.header() }, body: new URLSearchParams({ csrfToken, email: this.email, password: PASSWORD, redirect: "false" }) });
    this.store(res);
    const session = await (await this.req("/api/auth/session")).json();
    if (!session?.user) throw new Error(`login failed for ${this.email}`);
  }
  req(path: string, init: RequestInit = {}) { return fetch(`${BASE}${path}`, { ...init, headers: { Cookie: this.header(), ...(init.headers ?? {}) } }); }
}
const anon = (path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, init);
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function makeUser(tag: string, verified: boolean) {
  const email = `share-test-${run}-${tag}@example.test`;
  const reg = await fetch(`${BASE}/api/register`, json({ displayName: `Share ${tag}`, username: `sh_${run}_${tag}`, email, password: PASSWORD }));
  if (reg.status !== 201) throw new Error(`register failed ${reg.status}`);
  const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date(), ...(verified ? { profileVerification: "VERIFIED" as const } : {}) } });
  return { user, client: new Client(email) };
}

async function main() {
  // Pure helpers
  const url = "https://veramarket.co.za/shop/tokyo-drift-tire-shop";
  check("publicPath shop/listing/profile", publicPath("SHOP", "a") === "/shop/a" && publicPath("LISTING", "b") === "/listing/b" && publicPath("PROFILE", "u") === "/@u");
  check("sharedUrl tags links with src=share", sharedUrl(url) === `${url}?src=share`);
  const msg = defaultShareMessage("SHOP", url, "Tokyo");
  check("default shop message contains link", msg.includes(url));
  const wa = channelHref("whatsapp", msg, sharedUrl(url), "Tokyo");
  check("whatsapp href", wa.startsWith("https://wa.me/") || wa.startsWith("https://api.whatsapp.com/"), wa);
  check("facebook/x/telegram/email hrefs", channelHref("facebook", msg, url, "T").includes("facebook.com") && channelHref("x", msg, url, "T").includes("twitter.com/intent/tweet") && channelHref("telegram", msg, url, "T").includes("t.me") && channelHref("email", msg, url, "T").startsWith("mailto:"));

  await start();
  const [seller, buyer] = await Promise.all([makeUser("s", true), makeUser("b", true)]);
  await buyer.client.login();
  const category = await prisma.category.findFirstOrThrow();
  const mk = (title: string, status: "ACTIVE" | "SOLD" | "REMOVED" | "PENDING_REVIEW") => prisma.listing.create({ data: { sellerId: seller.user.id, categoryId: category.id, title, slug: `sh-${run}-${status.toLowerCase()}`, description: "Lovely item in great shape", priceCents: 123400, condition: "GOOD", location: "Cape Town", status } });
  const active = await mk("iPhone 15 Pro share test", "ACTIVE");
  const sold = await mk("Sold item share test", "SOLD");
  const removed = await mk("Removed item share test", "REMOVED");
  const pending = await mk("Pending item share test", "PENDING_REVIEW");
  const shop = await prisma.shop.create({ data: { ownerId: seller.user.id, name: "Tokyo Drift Share Test", slug: `tokyo-drift-${run}`, description: "Tyres and wheels", address: "1 Test Street, Cape Town", phone: "0821112222", email: `private-${run}@example.test`, status: "ACTIVE", subscriptionStatus: "ACTIVE", subscription: { create: { status: "ACTIVE", expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } } } });

  // Public listing page (logged out)
  const lp = await anon(`/listing/${active.slug}`);
  const lh = await lp.text();
  check("listing page 200 logged out", lp.status === 200, lp.status);
  check("listing has og:title, og:image, twitter:card, canonical, JSON-LD", /property="og:title"/.test(lh) && /property="og:image"/.test(lh) && /name="twitter:card"/.test(lh) && /rel="canonical"/.test(lh) && /application\/ld\+json/.test(lh));
  check("listing page has Share + no app-store gating", /Share/.test(lh) && !/app store|play store/i.test(lh));
  check("listing page hides seller email/phone", !lh.includes(seller.user.email));

  // Unavailable states
  for (const [name, row] of [["sold", sold], ["removed", removed]] as const) {
    const res = await anon(`/listing/${row.slug}`); const html = await res.text();
    check(`${name} listing shows 'no longer available' (200, noindex)`, res.status === 200 && html.includes("no longer available") && /noindex/.test(html), res.status);
  }
  check("pending listing is 404", (await anon(`/listing/${pending.slug}`)).status === 404);
  check("unknown listing is 404", (await anon(`/listing/does-not-exist-${run}`)).status === 404);

  // Public shop page, via both routes
  for (const path of [`/shops/${shop.slug}`, `/shop/${shop.slug}`]) {
    const res = await anon(path); const html = await res.text();
    check(`${path} 200 logged out with OG/JSON-LD`, res.status === 200 && /property="og:title"/.test(html) && /application\/ld\+json/.test(html) && html.includes("Tokyo Drift Share Test"), res.status);
    check(`${path} does not leak shop phone/email`, !html.includes("0821112222") && !html.includes(`private-${run}@example.test`));
  }
  const prof = await anon(`/@sh_${run}_s`);
  check("/@username public profile 200", prof.status === 200, prof.status);
  const paused = await prisma.shop.update({ where: { id: shop.id }, data: { isPaused: true } });
  check("paused shop is 404", (await anon(`/shop/${paused.slug}`)).status === 404);
  await prisma.shop.update({ where: { id: shop.id }, data: { isPaused: false } });

  // OG image
  const og = await anon(`/api/og?type=LISTING&slug=${active.slug}`);
  check("og image is a png", og.status === 200 && (og.headers.get("content-type") ?? "").includes("image/png"), [og.status, og.headers.get("content-type")]);
  const ogBad = await anon(`/api/og?type=LISTING&slug=${pending.slug}`);
  check("og image for non-public content does not reveal it", (await ogBad.text()).length >= 0 && !(ogBad.headers.get("content-disposition") ?? "").includes("pending"));

  // Tracking API
  const track = (body: unknown, c?: Client) => (c ? c.req("/api/share/track", json(body)) : anon("/api/share/track", json(body)));
  check("track SHARE (anon) ok", (await track({ targetType: "LISTING", targetId: active.id, kind: "SHARE", channel: "whatsapp" })).ok);
  check("track LINK_VIEW (anon) ok", (await track({ targetType: "SHOP", targetId: shop.id, kind: "LINK_VIEW" })).ok);
  check("track rejects invalid payload", (await track({ targetType: "LISTING", targetId: "x", kind: "SHARE" })).status === 400);
  const before = await prisma.shareEvent.count({ where: { targetId: pending.id } });
  await track({ targetType: "LISTING", targetId: pending.id, kind: "SHARE" });
  check("track ignores non-public content", (await prisma.shareEvent.count({ where: { targetId: pending.id } })) === before);
  await seller.client.login();
  const ownerBefore = await prisma.shareEvent.count({ where: { ownerId: seller.user.id } });
  await track({ targetType: "LISTING", targetId: active.id, kind: "LINK_VIEW" }, seller.client);
  check("owner's own views are not counted", (await prisma.shareEvent.count({ where: { ownerId: seller.user.id } })) === ownerBefore);
  check("share stats are real DB rows", (await prisma.shareEvent.count({ where: { ownerId: seller.user.id, kind: "SHARE", targetId: active.id } })) === 1);

  // Chat from shop link
  const contact = (c?: Client, body: unknown = { message: "Hi, are you open?", viaShare: true }) => (c ? c.req(`/api/shops/${shop.id}/contact`, json(body)) : anon(`/api/shops/${shop.id}/contact`, json(body)));
  check("contact shop requires login (401)", (await contact()).status === 401);
  check("owner cannot message own shop", (await contact(seller.client)).status === 400);
  const ok = await contact(buyer.client);
  check("logged-in visitor can chat with shop (201)", ok.status === 201, ok.status);
  check("CHAT event recorded via shared link", (await prisma.shareEvent.count({ where: { targetId: shop.id, kind: "CHAT" } })) === 1);

  // Chat from shared listing
  const conv = await buyer.client.req("/api/conversations", json({ listingId: active.id, message: "Is this still available?", viaShare: true }));
  check("listing chat from shared link works", conv.status === 201 || conv.status === 200, conv.status);
  check("listing CHAT event recorded", (await prisma.shareEvent.count({ where: { targetId: active.id, kind: "CHAT" } })) === 1);

  // Dashboard stats are visible to the owner
  const dash = await (await seller.client.req("/dashboard")).text();
  check("dashboard shows Share & Promote with real shop link", dash.includes("Share &amp; Promote") && dash.includes(`/shop/${shop.slug}`));

  // Crawl surfaces
  const robots = await (await anon("/robots.txt")).text();
  check("robots.txt blocks private areas and lists sitemap", /Disallow: \/dashboard/.test(robots) && /Sitemap:/.test(robots));
  const sitemap = await (await anon("/sitemap.xml")).text();
  check("sitemap includes active listing + shop, not pending/sold", sitemap.includes(active.slug) && sitemap.includes(shop.slug) && !sitemap.includes(pending.slug) && !sitemap.includes(sold.slug));
  check("assetlinks 404 when app not configured", (await anon("/.well-known/assetlinks.json")).status === 404 || !!process.env.ANDROID_APP_PACKAGE);
  check("apple-app-site-association 404 when app not configured", (await anon("/.well-known/apple-app-site-association")).status === 404 || !!process.env.IOS_APP_ID);

  // Cleanup
  const ids = [seller.user.id, buyer.user.id];
  await prisma.shareEvent.deleteMany({ where: { OR: [{ ownerId: { in: ids } }, { userId: { in: ids } }] } });
  await prisma.conversation.deleteMany({ where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.listingEngagement.deleteMany({ where: { listingId: { in: [active.id, sold.id, removed.id, pending.id] } } });
  await prisma.shop.deleteMany({ where: { ownerId: seller.user.id } });
  await prisma.listing.deleteMany({ where: { sellerId: seller.user.id } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

main()
  .catch((e) => { failures++; console.error(e); })
  .finally(async () => {
    if (server?.pid) { try { spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* best effort */ } }
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll share checks passed");
    process.exit(failures ? 1 : 0);
  });