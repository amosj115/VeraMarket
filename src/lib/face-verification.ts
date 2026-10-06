import { integrations } from "@/lib/config";
import type { FaceFailureCode } from "@/lib/face-verification-shared";

export * from "@/lib/face-verification-shared";

export type FaceCheckInput = {
  profilePhoto: { bytes: Uint8Array; mime: string };
  captures: { prompt: string; bytes: Uint8Array; mime: string }[];
};

export type FaceCheckResult = { passed: true } | { passed: false; failureCode: FaceFailureCode };

export type FaceProvider = {
  name: string;
  verify(input: FaceCheckInput): Promise<FaceCheckResult>;
};

const REASON_TO_CODE: Record<string, FaceFailureCode> = {
  no_face: "NO_FACE",
  low_quality: "LOW_QUALITY",
  multiple_faces: "MULTIPLE_FACES",
  no_match: "NO_MATCH",
  liveness_failed: "LIVENESS_FAILED",
};

/**
 * Generic HTTP adapter. The configured service receives multipart fields
 * `profile_photo`, `capture_<n>` and `prompts` (JSON array) and must answer
 * `{ match: boolean, liveness: boolean, face_count?: number, quality?: "ok"|"low", reason?: string }`.
 * Swap this for a vendor SDK (Rekognition, Onfido, Persona, ...) behind the same FaceProvider interface.
 */
function httpProvider(url: string, apiKey: string): FaceProvider {
  return {
    name: "http",
    async verify({ profilePhoto, captures }) {
      const form = new FormData();
      form.append("profile_photo", new Blob([profilePhoto.bytes as BlobPart], { type: profilePhoto.mime }), "profile");
      captures.forEach((capture, index) => form.append(`capture_${index}`, new Blob([capture.bytes as BlobPart], { type: capture.mime }), `capture_${index}`));
      form.append("prompts", JSON.stringify(captures.map((capture) => capture.prompt)));

      const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error(`Face provider responded ${response.status}`);
      const data = (await response.json()) as { match?: boolean; liveness?: boolean; face_count?: number; quality?: string; reason?: string };

      if (data.match === true && data.liveness === true) return { passed: true };
      if (data.reason && REASON_TO_CODE[data.reason]) return { passed: false, failureCode: REASON_TO_CODE[data.reason] };
      if (typeof data.face_count === "number" && data.face_count === 0) return { passed: false, failureCode: "NO_FACE" };
      if (typeof data.face_count === "number" && data.face_count > 1) return { passed: false, failureCode: "MULTIPLE_FACES" };
      if (data.quality === "low") return { passed: false, failureCode: "LOW_QUALITY" };
      if (data.liveness === false) return { passed: false, failureCode: "LIVENESS_FAILED" };
      return { passed: false, failureCode: "NO_MATCH" };
    },
  };
}

// Returns null when no provider is configured so callers can report that honestly instead of faking a result.
export function getFaceProvider(): FaceProvider | null {
  if (!integrations.faceVerification.configured) return null;
  if (process.env.NODE_ENV === "production" && !process.env.FACE_VERIFICATION_API_URL!.startsWith("https://")) {
    console.error("[face-verification] FACE_VERIFICATION_API_URL must use https:// in production");
    return null;
  }
  return httpProvider(process.env.FACE_VERIFICATION_API_URL!, process.env.FACE_VERIFICATION_API_KEY!);
}
