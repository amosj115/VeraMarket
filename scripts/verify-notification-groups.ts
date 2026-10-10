import "dotenv/config";
import "./db-guard";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/security/password";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient();
const run = Date.now().toString(36);
const PASSWORD = "Passw0rdTest1";
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`);
}

class Client {
  cookies = new Map<string, string>();
  constructor(public email: string) {}
  private store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  private header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  async login() {
    this.cookies.clear();
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
    this.store(csrfRes);
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this.header() },
      body: new URLSearchParams({ csrfToken, email: this.email, password: PASSWORD, json: "true" }),
    });
    this.store(res);
    const session = await (await this.req("/api/auth/session")).json();
    if (!session?.user) throw new Error(`login failed for ${this.email}`);
  }
  req(path: string, init: RequestInit = {}) {
    return fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: this.header() }, ...(init.headers ?? {}) });
  }
  async json(path: string, init: RequestInit = {}) {
    const res = await this.req(path, init);
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  async html(path: string) {
    const res = await this.req(path);
    return { status: res.status, text: await res.text() };
  }
}

type User = { id: string; email: string };
const created: User[] = [];

async function makeUser(tag: string): Promise<{ user: User; client: Client }> {
  const email = `gnt-test-${run}-${tag}@example.test`;
  const user = await prisma.user.create({
    data: { email, displayName: `GN Test ${tag.toUpperCase()}`, username: `gnt_${run}_${tag}`, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), profileVerification: "VERIFIED" },
  });
  created.push({ id: user.id, email });
  return { user, client: new Client(email) };
}

async function cleanup() {
  const ids = created.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const T0 = Date.now() - 60 * 60 * 1000;
const at = (minutes: number) => new Date(T0 + minutes * 60 * 1000);

type ChatGroup = { conversationId: string; senderId: string; displayName: string; count: number; preview: string; lastMessageAt: string; link: string };
type Summary = { chatGroups: ChatGroup[]; system: { count: number; preview: string; lastAt: string | null; link: string }; chatUnread: number; systemUnread: number; totalUnread: number };

async function sendMessage(convId: string, senderId: string, body: string, minutes: number, notify: boolean) {
  await prisma.message.create({ data: { conversationId: convId, senderId, body, createdAt: at(minutes) } });
  if (notify) {
    await prisma.notification.create({ data: { userId: RECIPIENT, type: "NEW_MESSAGE", title: "New message", body: "You have a new message.", link: `/messages/${convId}`, createdAt: at(minutes) } });
  }
}

let RECIPIENT = "";

async function main() {
  const R = await makeUser("r");
  const S1 = await makeUser("s1");
  const S2 = await makeUser("s2");
  const S3 = await makeUser("s3");
  RECIPIENT = R.user.id;
  const R2 = new Client(R.user.email);
  await R.client.login();
  await R2.login();

  const [c1a, c1b] = pair(R.user.id, S1.user.id);
  const [c2a, c2b] = pair(R.user.id, S2.user.id);
  const [c3a, c3b] = pair(R.user.id, S3.user.id);
  const conv1 = await prisma.conversation.create({ data: { userAId: c1a, userBId: c1b } });
  const conv2 = await prisma.conversation.create({ data: { userAId: c2a, userBId: c2b } });
  const conv3 = await prisma.conversation.create({ data: { userAId: c3a, userBId: c3b } });

  // Unauthenticated access.
  const anonSummary = await fetch(`${BASE}/api/notifications/summary`);
  check("summary requires a session", anonSummary.status === 401, anonSummary.status);
  const anonCount = await (await fetch(`${BASE}/api/notifications/unread-count`)).json();
  check("unread-count is zero when signed out", anonCount.count === 0 && anonCount.chat === 0 && anonCount.system === 0, anonCount);
  check("read-all requires a session", (await fetch(`${BASE}/api/notifications/read-all`, { method: "POST" })).status === 401);

  // --- Scenario 1: one person sends three messages -> one row, count 3.
  await sendMessage(conv1.id, S1.user.id, "Hi, is the couch still available?", 50, true);
  await sendMessage(conv1.id, S1.user.id, "I can collect this weekend.", 51, true);
  await sendMessage(conv1.id, S1.user.id, "Let me know!", 52, true);
  let summary = (await R.client.json("/api/notifications/summary")).body as Summary;
  check("3 messages from one person -> exactly one conversation row", summary.chatGroups.length === 1, summary.chatGroups);
  check("chat row unread count is 3", summary.chatGroups[0]?.count === 3, summary.chatGroups[0]);
  check("chat row identifies the sender, not display text", summary.chatGroups[0]?.senderId === S1.user.id, summary.chatGroups[0]);
  check("chat row links to the existing conversation", summary.chatGroups[0]?.link === `/messages/${conv1.id}`, summary.chatGroups[0]);
  check("chat row shows the latest message preview", summary.chatGroups[0]?.preview === "Let me know!", summary.chatGroups[0]);
  check("chat row carries the latest message time", summary.chatGroups[0]?.lastMessageAt === at(52).toISOString(), summary.chatGroups[0]);
  let counts = (await R.client.json("/api/notifications/unread-count")).body as { count: number; chat: number; system: number };
  check("unread-count reports chat=3, system=0, count=3", counts.chat === 3 && counts.system === 0 && counts.count === 3, counts);
  check("message notification rows exist but are not double counted", counts.count === 3, counts);

  // --- Scenario 2: same person sends seven -> row updates to 7, still one row.
  for (const [i, body] of ["Are you around?", "Hello?", "Still there?", "Ok thanks"].entries()) {
    await sendMessage(conv1.id, S1.user.id, body, 53 + i, true);
  }
  summary = (await R.client.json("/api/notifications/summary")).body as Summary;
  check("7 messages -> still one row, count 7", summary.chatGroups.length === 1 && summary.chatGroups[0]?.count === 7, summary.chatGroups);
  counts = (await R.client.json("/api/notifications/unread-count")).body;
  check("counts update to 7 without duplicates", counts.chat === 7 && counts.count === 7, counts);

  // --- Scenario 3: three different people -> three separate groups.
  await sendMessage(conv3.id, S3.user.id, "Do you deliver to Midrand?", 58, true);
  await sendMessage(conv2.id, S2.user.id, "Is this still for sale?", 59, true);
  await sendMessage(conv2.id, S2.user.id, "I could offer R800.", 60, true);
  summary = (await R.client.json("/api/notifications/summary")).body as Summary;
  const bySender = new Map(summary.chatGroups.map((g) => [g.senderId, g.count]));
  check("three senders -> three separate rows", summary.chatGroups.length === 3, summary.chatGroups.map((g) => g.senderId));
  check("counts split per person (7 / 2 / 1)", bySender.get(S1.user.id) === 7 && bySender.get(S2.user.id) === 2 && bySender.get(S3.user.id) === 1, [...bySender]);
  check("rows sorted by latest activity first", summary.chatGroups[0]?.senderId === S2.user.id && summary.chatGroups[1]?.senderId === S3.user.id && summary.chatGroups[2]?.senderId === S1.user.id, summary.chatGroups.map((g) => g.senderId));
  check("total chat unread is 10", summary.chatUnread === 10 && summary.totalUnread === 10, summary);

  // --- Scenario 4: system notifications collapse into one Vera Market Updates row.
  const systemRows = [
    { type: "ACHIEVEMENT_EARNED" as const, title: "Achievement unlocked: First sale", body: "You completed your first sale.", link: "/dashboard" },
    { type: "TRENDING_MATCH" as const, title: "New listings are trending", body: "Mountain bike is trending now.", link: "/trending" },
    { type: "BOOST_ACTIVATED" as const, title: "Boost activated", body: "Your listing is now a top ad.", link: "/profile/boosts" },
    { type: "ACCOUNT_SECURITY" as const, title: "New sign-in detected", body: "A new device signed in to your account.", link: "/profile/settings" },
    { type: "FOLLOWED_SELLER_LISTING" as const, title: "New listing from GN Test S1", body: "GN Test S1 posted a bicycle for R500.", link: "/listing/gnt-bicycle" },
  ];
  for (const [i, row] of systemRows.entries()) {
    await prisma.notification.create({ data: { userId: R.user.id, ...row, dedupeKey: `gnt:${run}:${i}`, createdAt: at(70 + i) } });
  }
  summary = (await R.client.json("/api/notifications/summary")).body as Summary;
  check("system notifications -> one Vera Market Updates row", summary.system.count === 5, summary.system);
  check("system group preview shows the latest update", summary.system.preview === "GN Test S1 posted a bicycle for R500.", summary.system);
  check("system group shows the latest update time", summary.system.lastAt === at(74).toISOString(), summary.system);
  check("system group links to the dedicated view", summary.system.link === "/notifications/system", summary.system);
  check("system unread reported separately from chat", summary.systemUnread === 5 && summary.chatUnread === 10 && summary.totalUnread === 15, summary);

  const sysList = await R.client.json("/api/notifications?scope=system");
  const sysItems = sysList.body.items as { id: string; type: string; link: string; isRead: boolean }[];
  check("system view lists the five individual updates", sysList.status === 200 && sysItems.length === 5, sysList.body);
  check("system view never contains message notifications", sysItems.every((i) => i.type !== "NEW_MESSAGE"), sysItems.map((i) => i.type));
  check("system view unreadCount matches the group count", sysList.body.unreadCount === 5, sysList.body.unreadCount);
  check("individual content and links preserved", sysItems.some((i) => i.link === "/listing/gnt-bicycle") && sysItems.some((i) => i.link === "/dashboard"), sysItems.map((i) => i.link));
  const allList = await R.client.json("/api/notifications?limit=50");
  check("default list still returns every notification row", (allList.body.items as unknown[]).length === 15, (allList.body.items as unknown[]).length);

  // --- Scenario 5: opening a conversation clears its group only.
  const conv1Messages = await R.client.json(`/api/conversations/${conv1.id}/messages`);
  check("conversation opens and returns messages", conv1Messages.status === 200, conv1Messages.status);
  summary = (await R.client.json("/api/notifications/summary")).body as Summary;
  const remaining = new Map(summary.chatGroups.map((g) => [g.conversationId, g.count]));
  check("opened conversation row disappears", !remaining.has(conv1.id) && summary.chatGroups.length === 2, [...remaining.keys()]);
  check("other people's counts untouched", remaining.get(conv2.id) === 2 && remaining.get(conv3.id) === 1, [...remaining]);
  check("chat unread drops to the other two senders", summary.chatUnread === 3, summary.chatUnread);
  const stale = await prisma.notification.count({ where: { userId: R.user.id, type: "NEW_MESSAGE", link: `/messages/${conv1.id}`, readAt: null } });
  check("matching message notification rows marked read with the chat", stale === 0, stale);
  const otherStale = await prisma.notification.count({ where: { userId: R.user.id, type: "NEW_MESSAGE", link: `/messages/${conv2.id}`, readAt: null } });
  check("other conversation's message rows still unread", otherStale === 2, otherStale);

  // --- Scenario 6: reading a system notification updates the group count.
  const newest = sysItems[0];
  const patched = await R.client.json(`/api/notifications/${newest.id}`, { method: "PATCH" });
  check("system notification marked read", patched.status === 200, patched.body);
  summary = (await R.client.json("/api/notifications/summary")).body as Summary;
  check("system group count drops to 4", summary.system.count === 4, summary.system);
  counts = (await R.client.json("/api/notifications/unread-count")).body;
  check("unread-count system drops to 4", counts.system === 4, counts);
  const unreadSys = await R.client.json("/api/notifications?scope=system&filter=unread");
  check("system unread filter lists the remaining four", unreadSys.body.items.length === 4 && unreadSys.body.unreadCount === 4, unreadSys.body);

  // --- Scenario 7: refreshing preserves accurate counts.
  const refreshA = (await R.client.json("/api/notifications/summary")).body as Summary;
  const refreshB = (await R.client.json("/api/notifications/summary")).body as Summary;
  check("repeat fetch returns identical counts (no drift)", JSON.stringify(refreshA) === JSON.stringify(refreshB), { refreshA, refreshB });
  check("refreshed totals stay consistent", refreshA.totalUnread === refreshA.chatUnread + refreshA.systemUnread && refreshA.totalUnread === 7, refreshA);

  // --- Scenario 8: a second device sees the same counts (no double counting).
  const device2 = (await R2.json("/api/notifications/summary")).body as Summary;
  check("second device sees identical groups", JSON.stringify(device2) === JSON.stringify(refreshA), { device2 });
  const all = await R.client.json("/api/notifications/read-all", { method: "POST" });
  check("mark all as read clears messages and notifications", all.status === 200 && all.body.updated === 7 && all.body.messagesUpdated === 3, all.body);
  const afterAll1 = (await R.client.json("/api/notifications/summary")).body as Summary;
  const afterAll2 = (await R2.json("/api/notifications/summary")).body as Summary;
  check("both devices read zero after mark-all", afterAll1.totalUnread === 0 && afterAll2.totalUnread === 0, { afterAll1, afterAll2 });
  const secondRun = await R2.json("/api/notifications/read-all", { method: "POST" });
  check("second mark-all is a no-op (no negative/decrement)", secondRun.body.updated === 0 && secondRun.body.messagesUpdated === 0, secondRun.body);
  const zero = (await R.client.json("/api/notifications/unread-count")).body;
  check("counts stay at zero, never negative", zero.count === 0 && zero.chat === 0 && zero.system === 0, zero);

  // --- Scenario 9: links still open the right targets.
  const history = await R.client.json("/api/notifications?scope=system&limit=50");
  const historyItems = history.body.items as { type: string; link: string }[];
  check("every system link preserved", systemRows.every((row) => historyItems.some((item) => item.link === row.link)), historyItems.map((i) => i.link));
  const convLink = await R.client.json(`/api/conversations/${conv2.id}/messages`);
  check("conversation link target resolves", convLink.status === 200, convLink.status);

  // --- Scenario 10: read history stays accessible under retention rules.
  check("read updates remain in history", historyItems.length === 5 && history.body.unreadCount === 0, history.body.unreadCount);
  const page1 = await R.client.json("/api/notifications?scope=system&limit=2");
  const page2 = await R.client.json(`/api/notifications?scope=system&limit=2&cursor=${page1.body.nextCursor}`);
  check("history paginates with a cursor", page1.body.items.length === 2 && page2.body.items.length === 2 && page2.body.items[0].id !== page1.body.items[0].id, { p1: page1.body.items.length, p2: page2.body.items.length });
  const del = await R.client.json(`/api/notifications/${(history.body.items as { id: string }[])[4].id}`, { method: "DELETE" });
  check("individual update deletable", del.status === 200, del.body);
  check("remaining history intact after delete", (await R.client.json("/api/notifications?scope=system&limit=50")).body.items.length === 4);

  // --- Page smoke tests.
  const centrePage = await R.client.html("/notifications");
  check("notification centre page renders", centrePage.status === 200 && centrePage.text.includes("Notifications"), centrePage.status);
  const systemPage = await R.client.html("/notifications/system");
  check("system notifications page renders", systemPage.status === 200 && systemPage.text.includes("Vera Market Updates"), systemPage.status);
  const anonPage = await fetch(`${BASE}/notifications`, { redirect: "manual" });
  check("centre redirects signed-out visitors to login", anonPage.status >= 300 && anonPage.status < 400, anonPage.status);
}

main()
  .catch((error) => { failures++; console.error(error); })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
  });
