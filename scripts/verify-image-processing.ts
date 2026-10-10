import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

// Proves the REAL client-side compression pipeline (src/lib/client-image.ts)
// inside headless Chromium with genuine canvas encoding — no mocks. Oversized
// noisy JPEG/PNG/WebP fixtures are generated in-page and must come out as
// real, decodable images below IMAGE_MAX_BYTES, or the pipeline must throw
// without producing a file. HEIC decoding is browser-dependent: Chromium
// cannot decode HEIC, so that case asserts the safe-stop error path.
// No database access, so no db-guard import.

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`);
}

function mb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

async function main() {
  const bundle = await build({
    entryPoints: [path.join(process.cwd(), "src", "lib", "client-image.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "VM",
    platform: "browser",
    target: "es2020",
    alias: { "@": path.resolve(process.cwd(), "src") },
    logLevel: "silent",
  });
  const code = bundle.outputFiles[0].text;
  const smallJpegBase64 = readFileSync(path.join(process.cwd(), "scripts", "fixtures", "profile-photo.jpg")).toString("base64");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    // tsx's esbuild transform injects `__name` keepNames helpers into function
    // expressions; provide the shim in the page (string form so it isn't transformed).
    await page.evaluate("window.__name = (fn) => fn");
    await page.addScriptTag({ content: code });

    const report = await page.evaluate(async (args: { smallJpegBase64: string }) => {
      const VM = (window as unknown as { VM: typeof import("../src/lib/client-image") }).VM;
      const MAX = VM.IMAGE_MAX_BYTES;
      const results: { name: string; ok: boolean; detail: unknown }[] = [];
      const sizes: { name: string; original: number; final: number | null; finalType: string | null }[] = [];
      const note = (name: string, ok: boolean, detail: unknown) => results.push({ name, ok, detail });

      function noiseCanvas(width: number, height: number, withAlpha: boolean) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        const img = ctx.createImageData(width, height);
        const data = img.data;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data[i] = (Math.random() * 256) | 0;
            data[i + 1] = (Math.random() * 256) | 0;
            data[i + 2] = (Math.random() * 256) | 0;
            if (withAlpha) {
              // Fully transparent border ring, noisy interior.
              const border = x < width * 0.08 || y < height * 0.08 || x >= width * 0.92 || y >= height * 0.92;
              data[i + 3] = border ? 0 : (Math.random() * 256) | 0;
            } else {
              data[i + 3] = 255;
            }
          }
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
      }

      async function toFile(canvas: HTMLCanvasElement, type: string, quality: number, name: string): Promise<File> {
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, quality));
        return new File([blob], name, { type });
      }

      async function decodedSize(file: Blob): Promise<{ width: number; height: number; cornerAlpha: number | null }> {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        let cornerAlpha: number | null = null;
        try {
          cornerAlpha = ctx.getImageData(0, 0, 1, 1).data[3];
        } catch {
          cornerAlpha = null;
        }
        return { width: bitmap.width, height: bitmap.height, cornerAlpha };
      }

      function heicLikeBytes(): File {
        const bytes = new Uint8Array(64);
        bytes.set([0, 0, 0, 24], 0);
        bytes.set([0x66, 0x74, 0x79, 0x70], 4);
        bytes.set([0x68, 0x65, 0x69, 0x63], 8);
        return new File([bytes], "IMG_0001.heic", { type: "image/heic" });
      }

      function oversizedCorruptJpeg(): File {
        const bytes = new Uint8Array(IMAGE_MAX + 512 * 1024);
        // SOI + APP0 + SOF0 claiming 6000x4000, then garbage: decoders must fail.
        bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 0);
        bytes.set([0xff, 0xc0, 0x00, 0x11, 8, 0x0f, 0xa0, 0x17, 0x70, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 20);
        for (let i = 60; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
        return new File([bytes], "broken.jpg", { type: "image/jpeg" });
      }

      const IMAGE_MAX = MAX;

      // 1. Small JPEG passes through untouched (no recompression).
      {
        const bin = atob(args.smallJpegBase64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const file = new File([arr], "small.jpg", { type: "image/jpeg" });
        const out = await VM.prepareImageForUpload(file);
        note("small jpeg passes through unchanged", out === file && out.size === file.size, { size: out.size });
        sizes.push({ name: "small jpeg (pass-through)", original: file.size, final: out.size, finalType: out.type });
      }

      // 2. Oversized noisy JPEG (~10MB+): compress to JPEG under the limit.
      {
        const src = await toFile(noiseCanvas(6000, 4000, false), "image/jpeg", 0.98, "big.jpg");
        const out = await VM.prepareImageForUpload(src);
        const dec = await decodedSize(out);
        const ratioSrc = 6000 / 4000;
        note("oversized jpeg: processed file under limit, jpeg mime", src.size > MAX && out.size > 0 && out.size <= MAX && out.type === "image/jpeg", { original: src.size, final: out.size, type: out.type });
        note("oversized jpeg: real decodable pixels, aspect kept", dec.width > 0 && dec.height > 0 && Math.abs(dec.width / dec.height - ratioSrc) / ratioSrc < 0.02 && dec.width <= 3072, dec);
        note("oversized jpeg: not the original object", out !== src, null);
        sizes.push({ name: "oversized JPEG 6000x4000", original: src.size, final: out.size, finalType: out.type });
        // Upload receives the processed file: stub XHR and inspect the FormData.
        const RealXHR = window.XMLHttpRequest;
        let uploadedSize = -1;
        let uploadedType = "";
        class CapturingXHR {
          upload = { onprogress: null as null | (() => void), onload: null as null | (() => void) };
          status = 0;
          responseText = "";
          timeout = 0;
          open() {}
          send(body: FormData) {
            const file = body.get("file") as File;
            uploadedSize = file.size;
            uploadedType = file.type;
            this.status = 201;
            this.responseText = JSON.stringify({ photoUrl: "https://example.test/x.jpg" });
            setTimeout(() => this.onload?.(), 0);
          }
          onerror: null | (() => void) = null;
          ontimeout: null | (() => void) = null;
          onabort: null | (() => void) = null;
          onload: null | (() => void) = null;
        }
        window.XMLHttpRequest = CapturingXHR as unknown as typeof XMLHttpRequest;
        try {
          const { promise } = VM.uploadProfilePhoto(out);
          const outcome = await promise;
          note("upload receives the processed file, not the original", outcome.ok === true && uploadedSize === out.size && uploadedSize < MAX && uploadedType === "image/jpeg" && uploadedSize !== src.size, { uploadedSize, uploadedType });
        } finally {
          window.XMLHttpRequest = RealXHR;
        }
      }

      // 3. Oversized noisy PNG: converted to JPEG under the limit.
      {
        const src = await toFile(noiseCanvas(3000, 3000, false), "image/png", undefined as unknown as number, "big.png");
        const out = await VM.prepareImageForUpload(src);
        const dec = await decodedSize(out);
        note("oversized png: converted to jpeg under limit", src.size > MAX && out.size > 0 && out.size <= MAX && out.type === "image/jpeg", { original: src.size, final: out.size, type: out.type });
        note("oversized png: decodable, square aspect kept", dec.width > 0 && Math.abs(dec.width / dec.height - 1) < 0.02, dec);
        sizes.push({ name: "oversized PNG 3000x3000", original: src.size, final: out.size, finalType: out.type });
      }

      // 4. Oversized noisy WebP: re-encoded to JPEG under the limit.
      {
        const src = await toFile(noiseCanvas(6000, 4000, false), "image/webp", 0.95, "big.webp");
        const out = await VM.prepareImageForUpload(src);
        const dec = await decodedSize(out);
        note("oversized webp: converted to jpeg under limit", src.size > MAX && out.size > 0 && out.size <= MAX && out.type === "image/jpeg", { original: src.size, final: out.size, type: out.type, srcType: src.type });
        note("oversized webp: decodable, aspect kept", dec.width > 0 && Math.abs(dec.width / dec.height - 1.5) / 1.5 < 0.02, dec);
        sizes.push({ name: "oversized WebP 6000x4000", original: src.size, final: out.size, finalType: out.type });
      }

      // 5. Oversized PNG WITH transparency: alpha preserved, still under limit.
      //    Heavy alpha-noise at 3072px forces multiple compression attempts.
      {
        const src = await toFile(noiseCanvas(3072, 3072, true), "image/png", undefined as unknown as number, "alpha.png");
        const out = await VM.prepareImageForUpload(src);
        const dec = await decodedSize(out);
        const alphaKept = dec.cornerAlpha === 0;
        note("transparent oversized png: under limit, alpha-capable output", src.size > MAX && out.size > 0 && out.size <= MAX && (out.type === "image/png" || out.type === "image/webp"), { original: src.size, final: out.size, type: out.type });
        note("transparent oversized png: corner stays transparent (not black)", alphaKept, { cornerAlpha: dec.cornerAlpha });
        note("transparent oversized png: aspect kept", Math.abs(dec.width / dec.height - 1) < 0.02, dec);
        sizes.push({ name: "oversized transparent PNG 3072x3072", original: src.size, final: out.size, finalType: out.type });
      }

      // 6. HEIC-like file (Chromium cannot decode HEIC): safe stop, clear message.
      {
        let threw: string | null = null;
        let produced: File | null = null;
        try {
          produced = await VM.prepareImageForUpload(heicLikeBytes());
        } catch (err) {
          threw = err instanceof Error ? err.message : String(err);
        }
        note("heic: browser cannot decode -> clear error, no file produced", produced === null && threw !== null && /HEIC|HEIF/.test(threw), { threw });
        sizes.push({ name: "HEIC-like (undecodable in Chromium)", original: 64, final: null, finalType: null });
      }

      // 7. Oversized corrupt JPEG: decode fails -> stop before upload.
      {
        const src = oversizedCorruptJpeg();
        let threw: string | null = null;
        let produced: File | null = null;
        try {
          produced = await VM.prepareImageForUpload(src);
        } catch (err) {
          threw = err instanceof Error ? err.message : String(err);
        }
        note("corrupt oversized jpeg: rejected, no upload candidate", produced === null && threw !== null && /damaged|couldn't/i.test(threw), { threw, size: src.size });
        sizes.push({ name: "corrupt oversized JPEG", original: src.size, final: null, finalType: null });
      }

      // 8. Zero-byte file.
      {
        let threw: string | null = null;
        try {
          await VM.prepareImageForUpload(new File([], "empty.jpg"));
        } catch (err) {
          threw = err instanceof Error ? err.message : String(err);
        }
        note("zero-byte file rejected with clear message", threw !== null && /photo/i.test(threw), { threw });
      }

      // 9. Invalid dimensions (8x8 PNG stub) — under limit, dimension validation.
      {
        const bytes = new Uint8Array(32);
        bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
        bytes.set([0, 0, 0, 13], 8);
        bytes.set([0x49, 0x48, 0x44, 0x52], 12);
        bytes.set([0, 0, 0, 8], 16);
        bytes.set([0, 0, 0, 8], 20);
        let threw: string | null = null;
        try {
          await VM.prepareImageForUpload(new File([bytes], "tiny.png", { type: "image/png" }));
        } catch (err) {
          threw = err instanceof Error ? err.message : String(err);
        }
        note("8x8 image rejected for minimum dimensions", threw !== null && /too small|16/.test(threw), { threw });
      }

      // Contract: nothing ever above the limit.
      for (const row of sizes) {
        if (row.final !== null) {
          note(`contract: ${row.name} final size <= IMAGE_MAX_BYTES`, row.final <= MAX, row);
        }
      }

      return { results, sizes, max: MAX };
    }, { smallJpegBase64 });

    for (const row of report.results) check(row.name, row.ok, row.detail);
    console.log(`\nCompression results (IMAGE_MAX_BYTES = ${mb(report.max)}):`);
    for (const row of report.sizes) {
      const final = row.final === null ? "not produced (rejected)" : `${mb(row.final)} (${row.finalType})`;
      console.log(`  ${row.name}: ${mb(row.original)} -> ${final}`);
    }
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    failures++;
    console.error(error);
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
    process.exit(failures ? 1 : 0);
  });
