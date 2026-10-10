import "dotenv/config";
import "./db-guard";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { IMAGE_MAX_BYTES } from "../src/lib/security/image";
import { deleteStoredImage } from "../src/lib/storage";

// Profile photo upload end-to-end checks against a running server (VERIFY_BASE).
// Uses real JPEG/PNG/WebP fixtures (scripts/fixtures) plus crafted byte stubs for
// rejection paths. Cloudinary is the real one; every uploaded URL is deleted again.
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
  req(reqPath: string, init: RequestInit = {}) {
    return fetch(`${BASE}${reqPath}`, { ...init, headers: { Cookie: this.header(), ...(init.headers ?? {}) } });
  }
  async json(reqPath: string, init: RequestInit = {}) {
    const res = await this.req(reqPath, init);
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  async uploadPhoto(bytes: Uint8Array | Blob, filename: string, consent: boolean) {
    const form = new FormData();
    form.append("file", bytes instanceof Blob ? bytes : new Blob([new Uint8Array(bytes)]), filename);
    if (consent) form.append("consent", "true");
    const res = await this.req("/api/profile/photo", { method: "POST", body: form });
    return { status: res.status, body: await res.json().catch(() => null) as { photoUrl?: string; error?: string; code?: string } | null };
  }
  async uploadListingImage(bytes: Uint8Array | Blob, filename: string) {
    const form = new FormData();
    form.append("file", bytes instanceof Blob ? bytes : new Blob([new Uint8Array(bytes)]), filename);
    const res = await this.req("/api/uploads", { method: "POST", body: form });
    return { status: res.status, body: await res.json().catch(() => null) as { url?: string; error?: string; code?: string } | null };
  }
}

async function makeUser(tag: string) {
  const email = `pph-test-${run}-${tag}@example.test`;
  const reg = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: `PPH ${tag}`, username: `pph_${run}_${tag}`, email, password: PASSWORD }),
  });
  if (reg.status !== 201) throw new Error(`register failed ${reg.status}: ${await reg.text()}`);
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  const client = new Client(email);
  await client.login();
  return { client };
}

const fixture = (name: string) => readFile(path.join(process.cwd(), "scripts", "fixtures", name));

function heicBytes() {
  const bytes = new Uint8Array(64);
  bytes.set([0, 0, 0, 24], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  bytes.set([0x68, 0x65, 0x69, 0x63], 8);
  return bytes;
}

function pngWithIhdr(width: number, height: number) {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([0, 0, (width >> 8) & 0xff, width & 0xff], 16);
  bytes.set([0, 0, (height >> 8) & 0xff, height & 0xff], 20);
  return bytes;
}

const uploadedUrls: string[] = [];
async function expectPhoto201(client: Client, bytes: Uint8Array, name: string, tag: string) {
  const res = await client.uploadPhoto(bytes, name, true);
  const ok = res.status === 201 && typeof res.body?.photoUrl === "string" && res.body.photoUrl.startsWith("https://");
  if (ok && res.body?.photoUrl) uploadedUrls.push(res.body.photoUrl);
  check(`photo upload succeeds: ${tag}`, ok, res);
  return res;
}

async function main() {
  const jpeg = await fixture("profile-photo.jpg");
  const png = await fixture("profile-photo.png");
  const webp = await fixture("profile-photo.webp");
  const { client } = await makeUser("u1");

  // --- Unauthenticated and consent.
  const anon = await fetch(`${BASE}/api/profile/photo`, { method: "POST", body: (() => { const f = new FormData(); f.append("file", new Blob([jpeg]), "me.jpg"); f.append("consent", "true"); return f; })() });
  check("unauthenticated upload rejected (401)", anon.status === 401, anon.status);
  const noConsent = await client.uploadPhoto(jpeg, "me.jpg", false);
  check("missing consent rejected (CONSENT_REQUIRED)", noConsent.status === 400 && noConsent.body?.code === "CONSENT_REQUIRED", noConsent);

  // --- Valid formats, each persisted to the DB.
  const jpegRes = await expectPhoto201(client, jpeg, "me.jpg", "JPEG");
  await expectPhoto201(client, png, "me.png", "PNG");
  const webpRes = await expectPhoto201(client, webp, "me.webp", "WebP");
  const dbUser = await prisma.user.findFirst({ where: { email: client.email }, select: { avatarUrl: true } });
  check("DB avatarUrl matches the last uploaded photoUrl", dbUser?.avatarUrl === webpRes.body?.photoUrl, { db: dbUser?.avatarUrl, res: webpRes.body });
  void jpegRes;

  // --- Rejections with specific codes.
  const heic = await client.uploadPhoto(heicBytes(), "IMG_0001.heic", true);
  check("HEIC rejected with HEIC_UNSUPPORTED and a helpful message", heic.status === 400 && heic.body?.code === "HEIC_UNSUPPORTED" && /HEIC/.test(heic.body?.error ?? ""), heic);
  const gif = await client.uploadPhoto(new TextEncoder().encode("GIF89a...."), "x.gif", true);
  check("GIF rejected as unsupported type", gif.status === 400 && gif.body?.code === "UNSUPPORTED_TYPE", gif);
  const fakePng = await client.uploadPhoto(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]), "fake.png", true);
  check("magic-only fake PNG rejected as damaged", fakePng.status === 400 && fakePng.body?.code === "DAMAGED_IMAGE", fakePng);
  const tiny = await client.uploadPhoto(pngWithIhdr(8, 8), "tiny.png", true);
  check("8x8 photo rejected for minimum dimensions", tiny.status === 400 && tiny.body?.code === "IMAGE_DIMENSIONS", tiny);
  const hugeDim = await client.uploadPhoto(pngWithIhdr(9001, 100), "huge.png", true);
  check("9001px-wide photo rejected for maximum dimensions", hugeDim.status === 400 && hugeDim.body?.code === "IMAGE_DIMENSIONS", hugeDim);
  const oversized = new Uint8Array(IMAGE_MAX_BYTES + 1);
  oversized.set(jpeg, 0);
  const big = await client.uploadPhoto(oversized, "big.jpg", true);
  check("photo over the 4MB limit rejected as too large", big.status === 400 && big.body?.code === "FILE_TOO_LARGE", big);
  const empty = await client.uploadPhoto(new Uint8Array(0), "empty.jpg", true);
  check("empty file rejected", empty.status === 400 && empty.body?.code === "EMPTY_FILE", empty);

  // --- Retry after failure keeps working.
  await expectPhoto201(client, jpeg, "retry.jpg", "retry after rejections");

  // --- The other consumer of the shared validation: /api/uploads.
  const listingUpload = await client.uploadListingImage(jpeg, "listing.jpg");
  const listingOk = listingUpload.status === 201 && typeof listingUpload.body?.url === "string";
  if (listingOk && listingUpload.body?.url) uploadedUrls.push(listingUpload.body.url);
  check("listing image upload via /api/uploads succeeds", listingOk, listingUpload);
  const listingGif = await client.uploadListingImage(new TextEncoder().encode("GIF89a...."), "x.gif");
  check("/api/uploads rejects GIF with a code", listingGif.status === 400 && listingGif.body?.code === "UNSUPPORTED_TYPE", listingGif);
}

main()
  .catch((error) => { failures++; console.error(error); })
  .finally(async () => {
    for (const url of uploadedUrls) await deleteStoredImage(url);
    await prisma.user.deleteMany({ where: { email: { startsWith: `pph-test-${run}-` } } });
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
  });
