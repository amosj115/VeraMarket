import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  IMAGE_MAX_BYTES,
  detectImageType,
  getImageDimensions,
  isHeicImage,
  validateImageUpload,
} from "../../src/lib/security/image";

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "scripts", "fixtures", name)));
const jpeg = () => fixture("profile-photo.jpg");
const png = () => fixture("profile-photo.png");
const webp = () => fixture("profile-photo.webp");

const heic = () => {
  const bytes = new Uint8Array(64);
  bytes.set([0, 0, 0, 24], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
  bytes.set([0x68, 0x65, 0x69, 0x63], 8); // "heic"
  return bytes;
};

// PNG stub with only magic bytes + a valid IHDR (no pixel data): enough for
// header parsing while proving the app never needs real image decoding.
function pngWithIhdr(width: number, height: number) {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  bytes.set([0, 0, (width >> 8) & 0xff, width & 0xff], 16);
  bytes.set([0, 0, (height >> 8) & 0xff, height & 0xff], 20);
  return bytes;
}

function jpegWithSof(width: number, height: number) {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    // APP0 with correct length (16 = 2 length bytes + 14 payload bytes)
    0xff, 0xe0, 0x00, 0x10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    // SOF0
    0xff, 0xc0, 0x00, 0x11, 8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9, // EOI
  ]);
}

test("detectImageType accepts JPEG, PNG and WebP real fixtures", () => {
  assert.deepEqual(detectImageType(jpeg()), { mime: "image/jpeg", ext: "jpg" });
  assert.deepEqual(detectImageType(png()), { mime: "image/png", ext: "png" });
  assert.deepEqual(detectImageType(webp()), { mime: "image/webp", ext: "webp" });
});

test("detectImageType rejects non-images and RIFF files that are not WebP", () => {
  assert.equal(detectImageType(new TextEncoder().encode("hello world")), null);
  assert.equal(detectImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4])), null); // GIF
  assert.equal(detectImageType(new Uint8Array()), null);
  const riffNotWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]); // "WAVE"
  assert.equal(detectImageType(riffNotWebp), null);
});

test("isHeicImage detects HEIC/HEIF brands and rejects lookalikes", () => {
  assert.equal(isHeicImage(heic()), true);
  assert.equal(isHeicImage(jpeg()), false);
  const avif = heic();
  avif.set([0x61, 0x76, 0x69, 0x66], 8); // "avif"
  assert.equal(isHeicImage(avif), false);
  assert.equal(isHeicImage(new Uint8Array(4)), false);
});

test("getImageDimensions reads PNG, JPEG and WebP headers", () => {
  assert.deepEqual(getImageDimensions(png()), { width: 64, height: 64 });
  assert.deepEqual(getImageDimensions(jpeg()), { width: 64, height: 64 });
  assert.deepEqual(getImageDimensions(webp()), { width: 64, height: 64 });
  assert.deepEqual(getImageDimensions(pngWithIhdr(800, 600)), { width: 800, height: 600 });
  assert.deepEqual(getImageDimensions(jpegWithSof(1920, 1080)), { width: 1920, height: 1080 });
  assert.equal(getImageDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null); // magic only
});

test("validateImageUpload accepts the real JPEG, PNG and WebP fixtures", () => {
  for (const bytes of [jpeg(), png(), webp()]) {
    const result = validateImageUpload(bytes);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});

test("validateImageUpload enforces the size boundary at exactly the limit and rejects above it", () => {
  const exact = new Uint8Array(IMAGE_MAX_BYTES);
  exact.set(jpeg(), 0);
  const above = new Uint8Array(IMAGE_MAX_BYTES + 1);
  above.set(jpeg(), 0);
  const exactResult = validateImageUpload(exact);
  assert.equal(exactResult.ok, true, JSON.stringify(exactResult));
  const aboveResult = validateImageUpload(above);
  assert.equal(aboveResult.ok, false);
  assert.equal(aboveResult.ok === false && aboveResult.code, "FILE_TOO_LARGE");
});

test("validateImageUpload rejects empty, unsupported, HEIC, damaged and dimension-broken files", () => {
  const empty = validateImageUpload(new Uint8Array(0));
  assert.equal(empty.ok === false && empty.code, "EMPTY_FILE");

  const gif = validateImageUpload(new TextEncoder().encode("GIF89a...."));
  assert.equal(gif.ok === false && gif.code, "UNSUPPORTED_TYPE");

  const heicResult = validateImageUpload(heic());
  assert.equal(heicResult.ok === false && heicResult.code, "HEIC_UNSUPPORTED");

  const magicOnlyPng = validateImageUpload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]));
  assert.equal(magicOnlyPng.ok === false && magicOnlyPng.code, "DAMAGED_IMAGE");

  const tiny = validateImageUpload(pngWithIhdr(8, 8));
  assert.equal(tiny.ok === false && tiny.code, "IMAGE_DIMENSIONS");

  const huge = validateImageUpload(pngWithIhdr(9000, 100));
  assert.equal(huge.ok === false && huge.code, "IMAGE_DIMENSIONS");
});

test("validateImageUpload messages name the accepted formats or the fix", () => {
  const heicResult = validateImageUpload(heic());
  assert.equal(heicResult.ok === false && /HEIC/.test(heicResult.message), true);
  const gif = validateImageUpload(new TextEncoder().encode("GIF89a...."));
  assert.equal(gif.ok === false && /JPEG, PNG and WebP/.test(gif.message), true);
  const huge = validateImageUpload(pngWithIhdr(9000, 100));
  assert.equal(huge.ok === false && /longest side/.test(huge.message), true);
});
