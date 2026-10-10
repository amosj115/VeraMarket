import "dotenv/config";
import "./db-guard";
import http from "node:http";
import { rm } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/security/password";

// SERVER_NO_PROVIDER runs without face env vars; SERVER_WITH_PROVIDER is started with FACE_VERIFICATION_API_URL pointing at the stub below.
const SERVER_NO_PROVIDER = process.env.VERIFY_BASE_NO_PROVIDER ?? "http://localhost:3000";
const SERVER_WITH_PROVIDER = process.env.VERIFY_BASE_PROVIDER ?? "http://localhost:3200";
const STUB_PORT = Number(process.env.VERIFY_STUB_PORT ?? 3201);

const prisma = new PrismaClient();
const run = Date.now().toString(36);
const PASSWORD = "Passw0rdTest1";
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`); };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Stub provider: records what it received and answers according to `mode`.
let mode: { match: boolean; liveness: boolean; reason?: string } = { match: true, liveness: true };
const received: { fields: string[]; prompts?: string[] }[] = [];
const stub = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    const text = body.toString("latin1");
    const fields = [...text.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
    const promptsJson = text.match(/name="prompts"\r\n\r\n(\[[\s\S]*?\])/)?.[1];
    received.push({ fields, prompts: promptsJson ? JSON.parse(promptsJson) : undefined });
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer stub-key") { res.statusCode = 401; return res.end("{}"); }
    res.end(JSON.stringify(mode));
  });
});

class Client {
  cookies = new Map<string, string>();
  constructor(public base: string, public email: string) {}
  private store(res: Response) { for (const line of res.headers.getSetCookie()) { const [pair] = line.split(";"); const i = pair.indexOf("="); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); } }
  private header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  async login() {
    this.cookies.clear();
    const csrfRes = await fetch(`${this.base}/api/auth/csrf`); this.store(csrfRes);
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`${this.base}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this.header() }, body: new URLSearchParams({ csrfToken, email: this.email, password: PASSWORD, json: "true" }) });
    this.store(res);
    const session = await (await this.req("/api/auth/session")).json();
    if (!session?.user) throw new Error(`login failed for ${this.email}`);
  }
  req(path: string, init: RequestInit = {}) { return fetch(`${this.base}${path}`, { ...init, headers: { Cookie: this.header(), ...(init.headers ?? {}) } }); }
  async json(path: string, init: RequestInit = {}) { const res = await this.req(path, init); return { status: res.status, body: await res.json().catch(() => null) }; }
  post(path: string, body: unknown) { return this.json(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
}

// Minimal valid-signature images; the app only checks magic bytes, the stub provider does the "matching".
const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])], { type: "image/png" });
const jpg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: "image/jpeg" });
function photoForm(consent: boolean) { const f = new FormData(); f.append("file", png(), "me.png"); if (consent) f.append("consent", "true"); return f; }
function captureForm() { const f = new FormData(); for (let i = 0; i < 3; i++) f.append(`capture_${i}`, jpg(), `c${i}.jpg`); return f; }

async function makeUser(base: string, tag: string) {
  const email = `pv-test-${run}-${tag}@example.test`;
  const user = await prisma.user.create({ data: { email, displayName: `PV ${tag}`, username: `pv_${run}_${tag}`, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() } });
  const client = new Client(base, email);
  await client.login();
  return { user, client };
}

async function main() {
  await new Promise<void>((resolve) => stub.listen(STUB_PORT, resolve));
  const category = await prisma.category.findFirst({ where: { domain: "MARKETPLACE" } });
  if (!category) throw new Error("No marketplace category");

  // --- Server without a provider: must say so, never fake a result.
  const N = await makeUser(SERVER_NO_PROVIDER, "n");
  const ready = await N.client.json("/api/profile/photo", { method: "POST", body: photoForm(true) });
  check("photo upload works without provider", ready.status === 201, ready.body);
  const noProvider = await N.client.json("/api/profile/verify-face", { method: "POST", body: captureForm() });
  check("verification reports NOT_CONFIGURED (503) when no provider", noProvider.status === 503 && noProvider.body.code === "NOT_CONFIGURED", noProvider.body);
  const nStatus = await N.client.json("/api/profile/verification");
  check("user stays unverified and status says provider unconfigured", nStatus.body.status === "NOT_VERIFIED" && nStatus.body.providerConfigured === false, nStatus.body);

  // --- Server with the stub provider.
  const A = await makeUser(SERVER_WITH_PROVIDER, "a");
  const listingBody = { title: "Gate test item", description: "Created to test the profile gate.", priceRand: 10, categoryId: category.id, condition: "GOOD", location: "Pretoria", imageUrls: ["/uploads/x.jpg"] };

  for (const [name, call] of [
    ["create listing", () => A.client.post("/api/listings", listingBody)],
    ["create shop", () => A.client.post("/api/shops", {})],
    ["create service", () => A.client.post("/api/services", {})],
    ["create property", () => A.client.post("/api/properties", {})],
    ["start conversation", () => A.client.post("/api/conversations", { listingId: "ckxxxxxxxxxxxxxxxxxxxxxxx", message: "hi" })],
    ["follow seller", () => A.client.post(`/api/sellers/${N.user.id}/follow`, {})],
  ] as const) {
    const r = await call();
    check(`unverified user blocked: ${name}`, r.status === 403 && r.body?.code === "PROFILE_VERIFICATION_REQUIRED", r);
  }

  check("verify before photo is rejected", (await A.client.json("/api/profile/verify-face", { method: "POST", body: captureForm() })).body?.code === "PHOTO_REQUIRED");
  check("photo without consent rejected", (await A.client.json("/api/profile/photo", { method: "POST", body: photoForm(false) })).status === 400);
  const bad = new FormData(); bad.append("file", new Blob(["not an image"], { type: "image/png" }), "x.png"); bad.append("consent", "true");
  check("non-image upload rejected", (await A.client.json("/api/profile/photo", { method: "POST", body: bad })).status === 400);
  check("photo with consent accepted", (await A.client.json("/api/profile/photo", { method: "POST", body: photoForm(true) })).status === 201);
  const incomplete = new FormData(); incomplete.append("capture_0", jpg(), "c.jpg");
  check("incomplete camera capture rejected", (await A.client.json("/api/profile/verify-face", { method: "POST", body: incomplete })).status === 400);

  mode = { match: false, liveness: true, reason: "no_match" };
  const fail = await A.client.json("/api/profile/verify-face", { method: "POST", body: captureForm() });
  check("mismatch returns 422 NO_MATCH", fail.status === 422 && fail.body.failureCode === "NO_MATCH" && fail.body.passed === false, fail);
  check("failed attempt marks status FAILED, not banned", (await A.client.json("/api/profile/verification")).body.status === "FAILED");
  check("still gated after failure", (await A.client.post("/api/listings", listingBody)).status === 403);
  check("immediate retry is rate limited", (await A.client.json("/api/profile/verify-face", { method: "POST", body: captureForm() })).status === 429);

  console.log("      waiting for the retry interval...");
  await sleep(10500);
  mode = { match: true, liveness: true };
  const pass = await A.client.json("/api/profile/verify-face", { method: "POST", body: captureForm() });
  check("matching live capture verifies the profile", pass.status === 200 && pass.body.passed === true, pass);
  const last = received[received.length - 1];
  check("provider received profile photo + 3 captures + prompts", ["profile_photo", "capture_0", "capture_1", "capture_2", "prompts"].every((f) => last.fields.includes(f)) && last.prompts?.length === 3, last);
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: A.user.id } });
  check("VERIFIED + timestamp stored in the database", dbUser.profileVerification === "VERIFIED" && dbUser.profileVerifiedAt !== null);
  const created = await A.client.post("/api/listings", listingBody);
  check("verified user can create a listing", created.status === 201, created);

  const attempts = await prisma.faceVerificationAttempt.findMany({ where: { userId: A.user.id } });
  check("attempts logged as results only (2 attempts, 1 passed)", attempts.length === 2 && attempts.filter((a) => a.passed).length === 1, attempts);
  const audit = await prisma.auditLog.findMany({ where: { actorId: A.user.id, action: { startsWith: "FACE_VERIFICATION" } } });
  check("audit log records pass and fail", audit.length === 2, audit.map((a) => a.action));

  const profileHtml = await (await fetch(`${SERVER_WITH_PROVIDER}/u/${A.user.username}`)).text();
  check("public profile shows Verified Person", profileHtml.includes("Verified Person"));
  const unverifiedHtml = await (await fetch(`${SERVER_WITH_PROVIDER}/u/${N.user.username}`)).text();
  check("unverified profile does not show the badge", !unverifiedHtml.includes("Verified Person</span>") && unverifiedHtml.includes("Profile not verified"));
  const listingId = created.body.listing.id as string;
  await prisma.listing.update({ where: { id: listingId }, data: { status: "ACTIVE" } });
  const listingHtml = await (await fetch(`${SERVER_WITH_PROVIDER}/listing/${created.body.listing.slug}`)).text();
  check("listing seller block shows Verified Person badge", listingHtml.includes("Verified Person"));

  const swap = await A.client.json("/api/profile/photo", { method: "POST", body: photoForm(true) });
  check("changing the photo resets verification", swap.status === 201 && (await A.client.json("/api/profile/verification")).body.status === "NOT_VERIFIED");
  check("gated again after photo change", (await A.client.post("/api/listings", listingBody)).status === 403);

  // Provider outage must not count against the user or mark them failed.
  const before = (await A.client.json("/api/profile/verification")).body.attemptsRemaining;
  await prisma.faceVerificationAttempt.deleteMany({ where: { userId: A.user.id } });
  stub.close();
  await sleep(200);
  const outage = await A.client.json("/api/profile/verify-face", { method: "POST", body: captureForm() });
  check("provider outage returns PROVIDER_ERROR and keeps status", outage.body?.failureCode === "PROVIDER_ERROR" && (await A.client.json("/api/profile/verification")).body.status === "NOT_VERIFIED", outage);
  check("provider errors do not consume attempts", (await A.client.json("/api/profile/verification")).body.attemptsRemaining === 5 && typeof before === "number");

  // Daily attempt limit.
  await prisma.faceVerificationAttempt.createMany({ data: Array.from({ length: 5 }, () => ({ userId: A.user.id, provider: "http", passed: false, failureCode: "NO_MATCH", createdAt: new Date(Date.now() - 60 * 60 * 1000) })) });
  const limited = await A.client.json("/api/profile/verify-face", { method: "POST", body: captureForm() });
  check("daily attempt limit enforced (429)", limited.status === 429 && limited.body.code === "RATE_LIMITED", limited);
}

main()
  .catch((error) => { failures++; console.error(error); })
  .finally(async () => {
    const users = await prisma.user.findMany({ where: { email: { startsWith: `pv-test-${run}-` } }, select: { id: true, avatarUrl: true } });
    for (const u of users) if (u.avatarUrl) await rm(path.join(process.cwd(), "public", u.avatarUrl), { force: true });
    await prisma.listing.deleteMany({ where: { sellerId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await prisma.$disconnect();
    stub.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
  });
