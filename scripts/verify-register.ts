import "dotenv/config";
import "./db-guard";
import { PrismaClient } from "@prisma/client";

// Registration API checks against a running server (VERIFY_BASE):
// long-but-valid inputs succeed, rejects are friendly (never raw Zod text),
// duplicates are protected, and a registered account can log in (bcrypt round-trip).
const BASE = process.env.VERIFY_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient();
const run = Date.now().toString(36);
const PASSWORD16 = "Passw0rdTest1Abcd"; // 16 characters
const PASSWORD21 = "Str0ngPassphraseHere"; // 21 characters
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function register(body: unknown) {
  const res = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as { error?: string; user?: { username?: string } } | null };
}

class Client {
  cookies = new Map<string, string>();
  constructor(public email: string, public password: string) {}
  private store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  }
  private header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  async login() {
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
    this.store(csrfRes);
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this.header() },
      body: new URLSearchParams({ csrfToken, email: this.email, password: this.password, json: "true" }),
    });
    this.store(res);
    const session = await (await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: this.header() } })).json();
    return Boolean(session?.user);
  }
}

const longEmail = `reg.user.${"x".repeat(40)}+${run}@subdomain.example.test`;
const usernameA = `user_${run}_${"a".repeat(18)}`.slice(0, 30); // 30 characters
const userA = { displayName: "Registration Test Person", username: usernameA, email: longEmail, password: PASSWORD16 };

async function main() {
  // --- Batch 1 (stays within the 5/min rate limit).
  const created = await register(userA);
  check("30-char username + long email + 16-char password registers (201)", created.status === 201, created);

  const createdB = await register({ ...userA, username: `b_${run}`, email: `other.${longEmail}`, password: PASSWORD21 });
  check("21-character password registers (201)", createdB.status === 201, createdB);

  const dupUser = await register(userA);
  check("duplicate username rejected (409) with a clear message", dupUser.status === 409 && /already in use/i.test(dupUser.body?.error ?? ""), dupUser);

  const dupEmail = await register({ ...userA, username: `c_${run}` });
  check("duplicate email rejected (409) with a clear message", dupEmail.status === 409 && /already in use/i.test(dupEmail.body?.error ?? ""), dupEmail);

  const tooLong = await register({ ...userA, username: "a".repeat(31), email: `z.${longEmail}` });
  const tooLongMsg = tooLong.body?.error ?? "";
  check("31-char username rejected (400) with a friendly, field-named message", tooLong.status === 400 && /Username must be between 3 and 30 characters/.test(tooLongMsg), tooLong);
  check("no raw Zod internals in the username error", !/Too big|expected string/i.test(tooLongMsg), tooLongMsg);

  // The register route allows 5 requests per minute per IP — wait out the window.
  console.log("      waiting for the rate-limit window...");
  await sleep(61_000);

  // --- Batch 2.
  const badEmail = await register({ ...userA, username: `d_${run}`, email: "not-an-email" });
  check("invalid email rejected (400) with a friendly message", badEmail.status === 400 && /valid email address/i.test(badEmail.body?.error ?? ""), badEmail);

  const shortUser = await register({ ...userA, username: "ab", email: `s.${longEmail}` });
  check("2-char username rejected (400) with a friendly message", shortUser.status === 400 && /between 3 and 30 characters/.test(shortUser.body?.error ?? ""), shortUser);

  const longPassword = await register({ ...userA, username: `e_${run}`, email: `p.${longEmail}`, password: `Aa1${"x".repeat(72)}` });
  check("75-character password rejected (400) with a friendly message", longPassword.status === 400 && /72 characters or fewer/.test(longPassword.body?.error ?? ""), longPassword);

  const shortPassword = await register({ ...userA, username: `f_${run}`, email: `q.${longEmail}`, password: "Ab1xy" });
  check("5-character password rejected (400) with a friendly message", shortPassword.status === 400 && /at least 8 characters/.test(shortPassword.body?.error ?? ""), shortPassword);

  const missing = await register({ displayName: "No Password", username: `g_${run}`, email: `m.${longEmail}` });
  check("missing password reported as required, not a library error", missing.status === 400 && missing.body?.error === "Password is required.", missing);

  // Registered accounts must be able to log in (bcrypt hash/compare round-trip).
  const client = new Client(longEmail, PASSWORD16);
  check("registered account can log in with the 16-character password", await client.login());
}

main()
  .catch((error) => { failures++; console.error(error); })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `+${run}@` } } });
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
  });
