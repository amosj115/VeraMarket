import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// Point Prisma at the dedicated *_test database, matching scripts/test-e2e.ts, so this
// destructive fixture script can never touch production. NOTE: this check is inlined
// rather than imported from ./db-guard because ES-module imports are hoisted above the
// DATABASE_URL assignment below; a static inline guard is the only way to guarantee it
// runs after the assignment.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("Set TEST_DATABASE_URL before running this script.");
const dbName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\/+/, ""));
if (!dbName.endsWith("_test")) throw new Error("Refusing to run: TEST_DATABASE_URL must name a *_test database.");
process.env.DATABASE_URL = testDatabaseUrl;

// End-to-end verification of user-initiated account deletion and admin account
// management (holds, lifts, deletions), exercised against a real server and the test DB.
const prisma = new PrismaClient();
const run = Date.now().toString(36);
const PASSWORD = "Passw0rdTest1";
const PORT = 3333;
const BASE = `http://localhost:${PORT}`;
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`); };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let server: ChildProcess | undefined;

async function start() {
  server = spawn(`npx next dev -p ${PORT}`, { shell: true, env: { ...process.env, NEXT_DIST_DIR: `.next-persona-${PORT}`, AUTH_TRUST_HOST: "true", NEXTAUTH_URL: BASE }, stdio: "ignore" });
  for (let i = 0; i < 120; i++) { if (await fetch(`${BASE}/api/auth/csrf`).then((r) => r.ok).catch(() => false)) return; await sleep(1000); }
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
  async logout() { await fetch(`${BASE}/api/auth/signout`, { method: "POST", headers: { Cookie: this.header() } }).catch(() => {}); this.cookies.clear(); }
  async relogin() { this.cookies.clear(); await this.login(); }
  session() { return this.req("/api/auth/session").then((r) => r.json()); }
  req(path: string, init: RequestInit = {}) {
    // Only send a JSON Content-Type when a body is present. Sending it on a bodyless
    // GET makes some route handlers reject the request as malformed.
    const headers: Record<string, string> = { Cookie: this.header() };
    if (init.body) headers["Content-Type"] = "application/json";
    return fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  }
}
const json = (body: unknown, method: string = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function makeUser(tag: string, role: "USER" | "ADMIN" = "USER") {
  const email = `acct-${run}-${tag}@example.test`;
  // /api/register allows only 5 registrations per IP per minute, so back off and retry
  // on 429 rather than creating the accounts in parallel.
  let reg: Response | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    reg = await fetch(`${BASE}/api/register`, json({ displayName: `Acct ${tag}`, username: `ac_${run}_${tag}`, email, password: PASSWORD }));
    if (reg.status !== 429) break;
    await sleep(9000);
  }
  if (reg?.status !== 201) throw new Error(`register failed ${reg?.status}`);
  const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date(), profileVerification: "VERIFIED" as const, ...(role === "ADMIN" ? { role: "ADMIN" as const } : {}) } });
  return { user, client: new Client(email) };
}

async function main() {
  await start();\n\n  // Clean up leftover fixtures from prior failed runs to avoid polluting admin counts.
  await prisma.user.deleteMany({ where: { email: { contains: "acct-" } } });

  // --- Setup: admin, a normal user with content, and a second user (victim) ---
  const { user: admin, client: adminClient } = await makeUser("admin", "ADMIN");
  await adminClient.login();
  const { user: victim, client: victimClient } = await makeUser("victim");
  await victimClient.login();
  const { user: other } = await makeUser("other");
  const category = await prisma.category.findFirstOrThrow();

  const listing = await prisma.listing.create({ data: { sellerId: victim.id, categoryId: category.id, title: "Victim listing", slug: `acct-${run}-v1`, description: "For sale", priceCents: 50000, condition: "GOOD", location: "Cape Town", status: "ACTIVE" } });
  const shop = await prisma.shop.create({ data: { ownerId: victim.id, name: "Victim store", slug: `acct-${run}-vs`, description: "Store", address: "1 Test Street, Cape Town", status: "ACTIVE" } });
  // Unrelated content that must never be touched.
  const otherListing = await prisma.listing.create({ data: { sellerId: other.id, categoryId: category.id, title: "Other listing", slug: `acct-${run}-o1`, description: "For sale", priceCents: 90000, condition: "GOOD", location: "Cape Town", status: "ACTIVE" } });

  // --- TASK 6.3: unauthenticated user cannot delete an account ---
  const anonDelete = await fetch(`${BASE}/api/account`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
  check("3. unauthenticated cannot delete own account", anonDelete.status === 401, anonDelete.status);

  // --- TASK 6.4: unauthorized (non-admin) cannot use admin account actions ---
  const userHold = await victimClient.req("/api/admin/accounts", json({ userId: other.id, reason: "not allowed" }));
  const userLift = await victimClient.req("/api/admin/accounts", json({ userId: other.id }, "PATCH"));
  const userDelete = await victimClient.req("/api/admin/accounts", json({ userId: other.id, reason: "not allowed" }, "DELETE"));
  check("4. non-admin cannot hold", userHold.status === 403, userHold.status);
  check("4. non-admin cannot lift", userLift.status === 403, userLift.status);
  check("4. non-admin cannot delete", userDelete.status === 403, userDelete.status);

  // --- TASK 6.5 + 6.4: admin places a hold; held user blocked ---
  const holdRes = await adminClient.req("/api/admin/accounts", json({ userId: victim.id, reason: "Reported scam, under investigation" }));
  check("5. admin places hold with reason", holdRes.status === 200, await holdRes.clone().json().catch(() => holdRes.status));
  const heldRow = await prisma.user.findUnique({ where: { id: victim.id }, select: { status: true } });
  check("5. hold persisted as SUSPENDED", heldRow?.status === "SUSPENDED", heldRow?.status);
  const holdRecord = await prisma.accountHold.findFirst({ where: { userId: victim.id, active: true } });
  check("5. hold records reason and acting admin", !!holdRecord && holdRecord.reason.includes("scam") && holdRecord.placedById === admin.id, holdRecord);
  check("5. hold hides the ACTIVE listing", (await prisma.listing.findUnique({ where: { id: listing.id }, select: { status: true } }))?.status === "REMOVED");
  check("5. hold hides the ACTIVE shop", (await prisma.shop.findUnique({ where: { id: shop.id }, select: { status: true } }))?.status === "REMOVED");
  check("5. unrelated listing untouched by hold", (await prisma.listing.findUnique({ where: { id: otherListing.id }, select: { status: true } }))?.status === "ACTIVE");

  // --- TASK 6.6: held user cannot continue via existing session or direct API ---
  const heldSession = await victimClient.session();
  check("6. held user's existing session is invalidated", !heldSession?.user, heldSession?.user);
  const heldProfile = await victimClient.req("/api/profile");
  check("6. held user blocked from protected API via old cookie", heldProfile.status === 401, heldProfile.status);
  const heldCreate = await victimClient.req("/api/listings", json({ title: "Should fail", categoryId: category.id, description: "x", priceCents: 1000, condition: "GOOD", location: "Cape Town" }));
  check("6. held user cannot create a listing", heldCreate.status === 401 || heldCreate.status === 403, heldCreate.status);
  await victimClient.relogin().catch(() => {});
  const heldLoginSession = await victimClient.session().catch(() => ({ user: null }));
  check("6. held user cannot log back in", !heldLoginSession?.user, heldLoginSession);

  // --- TASK 6.7 + 6.8: lift restores account and only its own restricted content ---
  // A moderator independently rejects one listing during the hold; it must stay rejected.
  await prisma.listing.update({ where: { id: listing.id }, data: { status: "REJECTED" } });
  const liftRes = await adminClient.req("/api/admin/accounts", json({ userId: victim.id }, "PATCH"));
  check("7. admin lifts hold", liftRes.status === 200, await liftRes.clone().json().catch(() => liftRes.status));
  const restoredUser = await prisma.user.findUnique({ where: { id: victim.id }, select: { status: true } });
  check("7. lifted account is ACTIVE again", restoredUser?.status === "ACTIVE", restoredUser?.status);
  // Re-read the row after the lift; the earlier snapshot was taken while the hold was
  // still active and would always fail.
  const liftedHold = await prisma.accountHold.findFirst({ where: { userId: victim.id }, orderBy: { placedAt: "desc" } });
  check("7. lift records the lifting admin and time", !!liftedHold && liftedHold.active === false && liftedHold.liftedById === admin.id && !!liftedHold.liftedAt, liftedHold);
  check("8. independently REJECTED listing is NOT restored", (await prisma.listing.findUnique({ where: { id: listing.id }, select: { status: true } }))?.status === "REJECTED");
  check("8. the hold-hidden shop IS restored", (await prisma.shop.findUnique({ where: { id: shop.id }, select: { status: true } }))?.status === "ACTIVE");

  // --- TASK 6.8b: a lift never restores content that was already restricted BEFORE the hold ---
  // Setup: an already-REJECTED listing and an already-REMOVED listing exist before the hold.
  // The shop is hidden BEFORE the hold is placed, so the hold never records it as
  // restorable content and the lift must leave it REMOVED.
  await prisma.shop.update({ where: { id: shop.id }, data: { status: "REMOVED" } });
  const preRejected = await prisma.listing.create({ data: { sellerId: victim.id, categoryId: category.id, title: "Pre-rejected", slug: `acct-${run}-pr`, description: "x", priceCents: 1000, condition: "GOOD", location: "Cape Town", status: "REJECTED" } });
  const preRemoved = await prisma.listing.create({ data: { sellerId: victim.id, categoryId: category.id, title: "Pre-removed", slug: `acct-${run}-pm`, description: "x", priceCents: 1000, condition: "GOOD", location: "Cape Town", status: "REMOVED" } });
  const hold2Res = await adminClient.req("/api/admin/accounts", json({ userId: victim.id, reason: "Second hold for restore-scope test" }));
  check("8b. second hold placed", hold2Res.status === 200, await hold2Res.clone().json().catch(() => hold2Res.status));
  const lift2Res = await adminClient.req("/api/admin/accounts", json({ userId: victim.id }, "PATCH"));
  check("8b. second hold lifted", lift2Res.status === 200, await lift2Res.clone().json().catch(() => lift2Res.status));
  check("8b. listing REJECTED before the hold stays REJECTED", (await prisma.listing.findUnique({ where: { id: preRejected.id }, select: { status: true } }))?.status === "REJECTED");
  check("8b. listing REMOVED before the hold stays REMOVED", (await prisma.listing.findUnique({ where: { id: preRemoved.id }, select: { status: true } }))?.status === "REMOVED");
  check("8b. shop hidden independently during the hold is NOT restored", (await prisma.shop.findUnique({ where: { id: shop.id }, select: { status: true } }))?.status === "REMOVED");
  await victimClient.relogin();
  check("7. restored user can log in again", !!(await victimClient.session())?.user);

  // --- TASK 6.2: user cannot delete another user's account by swapping the payload ---
  const crossDelete = await victimClient.req("/api/account", json({ password: PASSWORD, userId: other.id }, "DELETE"));
  const otherStill = await prisma.user.findUnique({ where: { id: other.id }, select: { status: true } });
  check("2. user cannot delete another account via payload", crossDelete.status === 400 || otherStill?.status === "ACTIVE", { status: crossDelete.status, other: otherStill?.status });

  // --- TASK 6.9 + 6.1: self-service deletion handles dependants, keeps other users' data ---
  const selfDelete = await victimClient.req("/api/account", json({ password: "wrong-password" }, "DELETE"));
  check("1. self-delete rejects a wrong password", selfDelete.status === 403, selfDelete.status);
  const delRes = await victimClient.req("/api/account", json({ password: PASSWORD }, "DELETE"));
  check("1. user deletes own account with correct password", delRes.status === 200, await delRes.clone().json().catch(() => delRes.status));
  const deleted = await prisma.user.findUnique({ where: { id: victim.id }, select: { status: true, email: true, username: true, displayName: true, avatarUrl: true } });
  check("9. deleted account is DEACTIVATED and anonymised", deleted?.status === "DEACTIVATED" && deleted.email.includes("deleted") && deleted.username.startsWith("deleted_") && deleted.displayName === "Deleted account" && deleted.avatarUrl === null, deleted);
  check("9. personal rows (favorites/notifications) removed", (await prisma.notification.count({ where: { userId: victim.id } })) === 0);
  check("9. other user's listing still intact after victim deletion", (await prisma.listing.findUnique({ where: { id: otherListing.id }, select: { status: true, sellerId: true } }))?.status === "ACTIVE");
  const delSession = await victimClient.session().catch(() => ({ user: null }));
  check("10. deleted user's session is invalidated", !delSession?.user, delSession);
  const delLogin = await victimClient.relogin().catch(() => {});
  const delLoginSession = await victimClient.session().catch(() => ({ user: null }));
  void delLogin;
  check("10. deleted user cannot log back in", !delLoginSession?.user, delLoginSession);
  check("10. self-deletion writes an audit record", (await prisma.auditLog.count({ where: { targetId: victim.id, action: "ACCOUNT_SELF_DELETED" } })) === 1);

  // --- TASK 6.11: last active administrator is protected ---
  const otherAdmin = await prisma.user.findUnique({ where: { id: admin.id }, select: { id: true } });
  const lastAdminHold = await adminClient.req("/api/admin/accounts", json({ userId: otherAdmin!.id, reason: "Trying to lock out the last admin" }));
  check("11. last admin cannot be held", lastAdminHold.status === 400, lastAdminHold.status);
  const lastAdminDelete = await adminClient.req("/api/admin/accounts", json({ userId: otherAdmin!.id, reason: "Trying to delete the last admin" }, "DELETE"));
  check("11. last admin cannot be deleted", lastAdminDelete.status === 400, lastAdminDelete.status);
  const adminSelfDelete = await adminClient.req("/api/account", json({ password: PASSWORD }, "DELETE"));
  check("11. last admin cannot self-delete", adminSelfDelete.status === 400, adminSelfDelete.status);

    // --- TASK 6.10 + 6.12: audit records + existing flows still work ---
    const auditRows = await prisma.auditLog.findMany({ where: { targetType: "USER", targetId: victim.id }, select: { action: true } });
    check("10. expected audit actions recorded", ["ACCOUNT_HOLD_PLACED", "ACCOUNT_HOLD_LIFTED", "ACCOUNT_SELF_DELETED"].every((a) => auditRows.some((r) => r.action === a)), auditRows.map((r) => r.action));\n\n    const { user: freshUser, client: freshClient } = await makeUser("fresh");
    await freshClient.login();
    check("12. normal login still works", !!(await freshClient.session())?.user);
    const normalCreate = await freshClient.req("/api/listings", json({ title: "Fresh listing", categoryId: category.id, description: "This is a valid description that meets the minimum length requirement.", priceRand: 10, condition: "GOOD", location: "Cape Town", imageUrls: ["https://example.com/img.jpg"] }));
    check("12. normal user can still create a listing", normalCreate.status === 200 || normalCreate.status === 201, normalCreate.status);

  // --- Cleanup fixtures ---
  await prisma.auditLog.deleteMany({ where: { targetId: { in: [victim.id, admin.id, other.id] } } });
  await prisma.accountHold.deleteMany({ where: { userId: { in: [victim.id, other.id] } } });
  await prisma.listing.deleteMany({ where: { slug: { startsWith: `acct-${run}-` } } });
  await prisma.shop.deleteMany({ where: { id: shop.id } });
  await prisma.user.deleteMany({ where: { id: { in: [victim.id, other.id] } } });
  await prisma.user.deleteMany({ where: { email: { in: [`acct-${run}-admin@example.test`, `acct-${run}-fresh@example.test`] } } });
}

main()
  .catch((e) => { failures++; console.error(e); })
  .finally(async () => {
    if (server?.pid) { try { spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* best effort */ } }
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll account-management checks passed");
    process.exit(failures ? 1 : 0);
  });
