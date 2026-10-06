export type DetectedImage = { mime: string; ext: string };

const SIGNATURES: { mime: string; ext: string; magic: number[] }[] = [
  { mime: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp", ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
];

export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  for (const sig of SIGNATURES) {
    if (!sig.magic.every((byte, i) => bytes[i] === byte)) continue;
    if (sig.mime === "image/webp" && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== "WEBP") continue;
    return { mime: sig.mime, ext: sig.ext };
  }
  return null;
}
