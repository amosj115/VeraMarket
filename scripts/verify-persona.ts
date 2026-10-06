import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Exercises the real Persona integration code paths against locally started servers:
// signature enforcement, webhook -> Prisma status transitions, retry, cancel, configuration and storage errors.
// Webhooks are signed with a throwaway test secret exactly as Persona signs them. No result is ever faked in app code;
// the only call that cannot be tested without a Persona account is the outbound inquiry creation.
const prisma = new PrismaClient();
const run = Date.now().toString(36);
const PASSWORD = "Passw0rdTest1";
const WEBHOOK_SECRET = `wbhsec_test_${randomUUID()}`;
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`); };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const servers: ChildProcess[] = [];
async function startServer(port: number, env: Record<string, string>) {
  const child = spawn(`npx next dev -p ${port}`, { shell: true, env: { ...process.env, NEXT_DIST_DIR: `.next-persona-${port}`, AUTH_TRUST_HOST: "true", NEXTAUTH_URL: `http://localhost:${port}`, PERSONA_API_KEY: "", PERSONA_INQUIRY_TEMPLATE_ID: "", PERSONA_WEBHOOK_SECRET: "", ...env }, stdio: "ignore" });
  servers.push(child);
  for (let i = 0; i < 90; i++) {
    if (await fetch(`http://localhost:${port}/api/auth/csrf`).then((r) => r.ok).catch(() => false)) return `http://localhost:${port}`;
    await sleep(1000);
  }
  throw new Error(`server ${port} did not start`);
}

class Client {
  cookies = new Map<string, string>();
  constructor(public base: string, public email: string) {}
  private store(res: Response) { for (const line of res.headers.getSetCookie()) { const [pair] = line.split(";"); const i = pair.indexOf("="); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); } }
  private header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  async login() {
    const csrfRes = await fetch(`${this.base}/api/auth/csrf`); this.store(csrfRes);
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`${this.base}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this.header() }, body: new URLSearchParams({ csrfToken, email: this.email, password: PASSWORD, json: "true" }) });
    this.store(res);
    const session = await (await this.req("/api/auth/session")).json();
    if (!session?.user) throw new Error(`login failed for ${this.email}`);
  }
  req(path: string, init: RequestInit = {}) { return fetch(`${this.base}${path}`, { ...init, headers: { Cookie: this.header(), ...(init.headers ?? {}) } }); }
  async json(path: string, init: RequestInit = {}) { const res = await this.req(path, init); return { status: res.status, body: await res.json().catch(() => null) }; }
}

const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])], { type: "image/png" });
const photoForm = () => { const f = new FormData(); f.append("file", png(), "me.png"); f.append("consent", "true"); return f; };

async function makeUser(base: string, tag: string) {
  const username = `pa_${run}_${tag}`;
  const email = `persona-test-${run}-${tag}@example.test`;
  const reg = await fetch(`${base}/api/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: `Persona ${tag}`, username, email, password: PASSWORD }) });
  if (reg.status !== 201) throw new Error(`register failed ${reg.status}`);
  const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  const client = new Client(base, email);
  await client.login();
  return { user, client };
}

let clock = Date.now();
function webhook(inquiryId: string, status: string, userId: string, opts: { eventId?: string; at?: number } = {}) {
  const at = opts.at ?? (clock += 1000);
  const body = JSON.stringify({ data: { type: "event", id: opts.eventId ?? `evt_${randomUUID()}`, attributes: { name: `inquiry.${status}`, "created-at": new Date(at).toISOString(), payload: { data: { type: "inquiry", id: inquiryId, attributes: { status, "reference-id": userId } } } } } });
  return body;
}
function sign(body: string, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}
const post = (base: string, body: string, signature: string | null) => fetch(`${base}/api/webhooks/persona`, { method: "POST", headers: { "Content-Type": "application/json", ...(signature ? { "Persona-Signature": signature } : {}) }, body }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

async function main() {
  const [plain, withPersona, badStorage] = await Promise.all([
    startServer(3310, {}),
    startServer(3311, { PERSONA_API_KEY: "persona_sandbox_invalid_test_key", PERSONA_INQUIRY_TEMPLATE_ID: "itmpl_test", PERSONA_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    startServer(3312, { STORAGE_DRIVER: "s3", S3_BUCKET: "nonexistent-test-bucket", S3_REGION: "us-east-1", S3_ACCESS_KEY_ID: "invalid", S3_SECRET_ACCESS_KEY: "invalid", S3_PUBLIC_URL: "https://cdn.example.test", S3_ENDPOINT: "http://127.0.0.1:9" }),
  ]);

  // 1. Missing configuration
  const U0 = await makeUser(plain, "cfg");
  check("account creation + login works", Boolean(U0.user.id));
  check("profile photo upload works (local storage)", (await U0.client.json("/api/profile/photo", { method: "POST", body: photoForm() })).status === 201);
  const noCfg = await U0.client.json("/api/profile/identity/start", { method: "POST" });
  check("missing Persona config -> 503 NOT_CONFIGURED listing variables", noCfg.status === 503 && noCfg.body.code === "NOT_CONFIGURED" && noCfg.body.missing.includes("PERSONA_API_KEY"), noCfg);
  check("status shows provider unconfigured, user not verified", (await U0.client.json("/api/profile/verification")).body.providerConfigured === false);
  check("webhook endpoint refuses when secret unset", (await post(plain, "{}", "t=1,v1=x")).status === 503);

  // 2. Storage unavailable
  const U1 = await makeUser(badStorage, "stor");
  const stor = await U1.client.json("/api/profile/photo", { method: "POST", body: photoForm() });
  check("storage unavailable -> clear 503 error, no avatar saved", stor.status === 503 && /couldn't save|storage/i.test(stor.body?.error ?? "") && (await prisma.user.findUnique({ where: { id: U1.user.id } }))?.avatarUrl === null, stor);

  // 3. Full flow on the Persona-configured server
  const U = await makeUser(withPersona, "main");
  const noPhoto = await U.client.json("/api/profile/identity/start", { method: "POST" });
  check("start requires profile photo first", noPhoto.status === 400 && noPhoto.body.code === "PHOTO_REQUIRED", noPhoto);
  check("photo upload ok", (await U.client.json("/api/profile/photo", { method: "POST", body: photoForm() })).status === 201);
  const info = (await U.client.json("/api/profile/verification")).body;
  check("status reports persona provider, NOT_VERIFIED", info.provider === "persona" && info.status === "NOT_VERIFIED", info);
  const start = await U.client.json("/api/profile/identity/start", { method: "POST" });
  check("start with invalid Persona credentials -> 502 PROVIDER_ERROR (never verified)", start.status === 502 && start.body.code === "PROVIDER_ERROR", start);
  check("provider failure leaves user NOT_VERIFIED", (await prisma.user.findUnique({ where: { id: U.user.id } }))?.profileVerification === "NOT_VERIFIED");
  check("unauthenticated start rejected", (await fetch(`${withPersona}/api/profile/identity/start`, { method: "POST" })).status === 401);

  // Inquiry rows are normally created by /start after Persona returns an id; seed one as that code would.
  const inq1 = `inq_${randomUUID().slice(0, 12)}`;
  await prisma.identityVerification.create({ data: { userId: U.user.id, provider: "persona", externalId: inq1, state: "CREATED" } });
  await prisma.user.update({ where: { id: U.user.id }, data: { profileVerification: "PENDING" } });

  // Signature enforcement
  const approvedBody = webhook(inq1, "approved", U.user.id);
  check("webhook without signature rejected", (await post(withPersona, approvedBody, null)).status === 401);
  check("webhook with wrong secret rejected", (await post(withPersona, approvedBody, sign(approvedBody, "wrong"))).status === 401);
  check("webhook with tampered body rejected", (await post(withPersona, approvedBody.replace("approved", "approvee"), sign(approvedBody))).status === 401);
  check("webhook with stale timestamp rejected", (await post(withPersona, approvedBody, sign(approvedBody, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600))).status === 401);
  check("rejected webhooks did not verify user", (await prisma.user.findUnique({ where: { id: U.user.id } }))?.profileVerification === "PENDING");

  // Failure -> clear state -> retry
  const failBody = webhook(inq1, "declined", U.user.id);
  check("signed 'declined' webhook accepted", (await post(withPersona, failBody, sign(failBody))).status === 200);
  const failed = (await U.client.json("/api/profile/verification")).body;
  check("declined -> FAILED with DECLINED reason surfaced", failed.status === "FAILED" && failed.identityFailure === "DECLINED", failed);

  // Duplicate event is idempotent
  const dupId = `evt_${randomUUID()}`;
  const pend = webhook(inq1, "pending", U.user.id, { eventId: dupId });
  await post(withPersona, pend, sign(pend));
  const dup = await post(withPersona, pend, sign(pend));
  check("duplicate webhook event ignored", dup.body?.duplicate === true, dup);

  // Retry: new inquiry (what /start does after a terminal state), then approval
  const inq2 = `inq_${randomUUID().slice(0, 12)}`;
  await prisma.identityVerification.create({ data: { userId: U.user.id, provider: "persona", externalId: inq2, state: "CREATED" } });
  const pending2 = webhook(inq2, "pending", U.user.id);
  await post(withPersona, pending2, sign(pending2));
  check("retry in progress -> PENDING (not verified)", (await prisma.user.findUnique({ where: { id: U.user.id } }))?.profileVerification === "PENDING");
  const mismatch = webhook(inq2, "approved", "someone-else");
  await post(withPersona, mismatch, sign(mismatch));
  check("reference-id mismatch never verifies", (await prisma.user.findUnique({ where: { id: U.user.id } }))?.profileVerification === "PENDING");
  const staleApproved = webhook(inq2, "declined", U.user.id, { at: clock - 500000 });
  await post(withPersona, staleApproved, sign(staleApproved));
  check("out-of-order older event ignored", (await prisma.user.findUnique({ where: { id: U.user.id } }))?.profileVerification === "PENDING");
  const ok = webhook(inq2, "approved", U.user.id);
  check("signed 'approved' webhook accepted", (await post(withPersona, ok, sign(ok))).status === 200);
  const verified = await prisma.user.findUnique({ where: { id: U.user.id } });
  check("approved -> VERIFIED with timestamp in Prisma", verified?.profileVerification === "VERIFIED" && Boolean(verified.profileVerifiedAt), verified);
  check("API reports VERIFIED only after server confirmation", (await U.client.json("/api/profile/verification")).body.status === "VERIFIED");
  const again = await U.client.json("/api/profile/identity/start", { method: "POST" });
  check("verified user cannot restart", again.status === 409, again);

  // Cancel
  const C = await makeUser(withPersona, "cancel");
  await C.client.json("/api/profile/photo", { method: "POST", body: photoForm() });
  const inq3 = `inq_${randomUUID().slice(0, 12)}`;
  await prisma.identityVerification.create({ data: { userId: C.user.id, provider: "persona", externalId: inq3, state: "CREATED" } });
  await prisma.user.update({ where: { id: C.user.id }, data: { profileVerification: "PENDING" } });
  check("cancel endpoint -> CANCELLED, user NOT_VERIFIED", (await C.client.json("/api/profile/identity/cancel", { method: "POST" })).body?.cancelled === true && (await prisma.user.findUnique({ where: { id: C.user.id } }))?.profileVerification === "NOT_VERIFIED" && (await prisma.identityVerification.findUnique({ where: { externalId: inq3 } }))?.state === "CANCELLED");
  const exp = webhook(inq3, "expired", C.user.id);
  await post(withPersona, exp, sign(exp));
  check("expired inquiry keeps user retry-able (NOT_VERIFIED)", (await prisma.user.findUnique({ where: { id: C.user.id } }))?.profileVerification === "NOT_VERIFIED");
}

main()
  .catch((error) => { failures++; console.error(error); })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: `persona-test-${run}` } } });
    await prisma.webhookEvent.deleteMany({ where: { provider: "persona", receivedAt: { gte: new Date(Date.now() - 3600_000) } } });
    await prisma.$disconnect();
    for (const child of servers) { try { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* best effort */ } }
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
  });
