import { integrations } from "@/lib/config";

export type DiditBiometricResult =
  | { passed: true; livenessScore: number; faceMatchScore: number }
  | { passed: false; failureCode: DiditFailureCode; livenessScore?: number; faceMatchScore?: number };

export type DiditFailureCode =
  | "NOT_CONFIGURED"
  | "LIVENESS_FAILED"
  | "LOW_LIVENESS_SCORE"
  | "NO_FACE_DETECTED"
  | "LIVENESS_FACE_ATTACK"
  | "FACE_IN_BLOCKLIST"
  | "MULTIPLE_FACES_DETECTED"
  | "FACE_MATCH_FAILED"
  | "LOW_FACE_MATCH_SIMILARITY"
  | "NO_REFERENCE_IMAGE"
  | "PROVIDER_ERROR"
  | "STORAGE_ERROR"
  | "PHOTO_REQUIRED";

export const DIDIT_FAILURE_MESSAGES: Record<DiditFailureCode, string> = {
  NOT_CONFIGURED: "Biometric verification isn't configured on this server yet.",
  LIVENESS_FAILED: "We couldn't complete the liveness check.",
  LOW_LIVENESS_SCORE: "The liveness score was too low. Make sure you're in good lighting and try again.",
  NO_FACE_DETECTED: "No face was detected in your camera image. Please try again with better lighting.",
  LIVENESS_FACE_ATTACK: "A presentation attack was detected. Please use a live camera feed.",
  FACE_IN_BLOCKLIST: "This face matches a blocked entry.",
  MULTIPLE_FACES_DETECTED: "Multiple faces were detected. Please ensure only you are in the frame.",
  FACE_MATCH_FAILED: "Face match could not be completed.",
  LOW_FACE_MATCH_SIMILARITY: "Your live photo didn't sufficiently match your profile photo.",
  NO_REFERENCE_IMAGE: "No face could be detected in your profile photo. Please re-upload it.",
  PROVIDER_ERROR: "The verification service had a problem. Please try again shortly.",
  STORAGE_ERROR: "Could not read your profile photo. Please re-upload it.",
  PHOTO_REQUIRED: "Upload your profile photo and accept the photo requirements first.",
};

const DIDIT_API_BASE = "https://verification.didit.me/v3";

async function callDiditApi(
  endpoint: string,
  formData: FormData,
  apiKey: string
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${DIDIT_API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = await response.text().catch(() => null);
  }

  return { status: response.status, data };
}

function mapLivenessWarnings(warnings: Array<{ risk: string; log_type: string }>): DiditFailureCode | null {
  for (const w of warnings) {
    if (w.log_type === "error") {
      switch (w.risk) {
        case "LOW_LIVENESS_SCORE":
          return "LOW_LIVENESS_SCORE";
        case "NO_FACE_DETECTED":
          return "NO_FACE_DETECTED";
        case "LIVENESS_FACE_ATTACK":
          return "LIVENESS_FACE_ATTACK";
        case "FACE_IN_BLOCKLIST":
        case "POSSIBLE_FACE_IN_BLOCKLIST":
          return "FACE_IN_BLOCKLIST";
      }
    }
    if (w.log_type === "warning" && w.risk === "MULTIPLE_FACES_DETECTED") {
      return "MULTIPLE_FACES_DETECTED";
    }
  }
  return null;
}

function mapFaceMatchWarnings(warnings: Array<{ risk: string; log_type: string }>): DiditFailureCode | null {
  for (const w of warnings) {
    if (w.log_type === "error") {
      switch (w.risk) {
        case "LOW_FACE_MATCH_SIMILARITY":
          return "LOW_FACE_MATCH_SIMILARITY";
        case "NO_REFERENCE_IMAGE":
          return "NO_REFERENCE_IMAGE";
      }
    }
  }
  return null;
}

export async function verifyBiometric(
  profilePhotoBytes: Uint8Array,
  profilePhotoMime: string,
  liveSelfieBytes: Uint8Array,
  liveSelfieMime: string,
  options: { faceMatchThreshold?: number; livenessThreshold?: number } = {}
): Promise<DiditBiometricResult> {
  if (!integrations.didit.configured) {
    return { passed: false, failureCode: "NOT_CONFIGURED" };
  }

  const apiKey = process.env.DIDIT_API_KEY!;
  const faceMatchThreshold = options.faceMatchThreshold ?? 50;
  const livenessThreshold = options.livenessThreshold ?? 30;

  try {
    const livenessForm = new FormData();
    livenessForm.append("user_image", new Blob([liveSelfieBytes as BlobPart], { type: liveSelfieMime }), "selfie.jpg");
    livenessForm.append("face_liveness_score_decline_threshold", String(livenessThreshold));
    livenessForm.append("rotate_image", "true");
    livenessForm.append("save_api_request", "false");

    const livenessResult = await callDiditApi("/passive-liveness/", livenessForm, apiKey);

    if (livenessResult.status !== 200) {
      console.error("[didit-biometric] liveness error", livenessResult.status, livenessResult.data);
      return { passed: false, failureCode: "PROVIDER_ERROR" };
    }

    const livenessData = livenessResult.data as {
      liveness: {
        status: "Approved" | "Declined";
        score: number | null;
        warnings: Array<{ risk: string; log_type: string }>;
      };
    };

    if (livenessData.liveness.status === "Declined") {
      const failureCode = mapLivenessWarnings(livenessData.liveness.warnings) ?? "LIVENESS_FAILED";
      return {
        passed: false,
        failureCode,
        livenessScore: livenessData.liveness.score ?? undefined,
      };
    }

    const livenessScore = livenessData.liveness.score ?? 0;

    const faceMatchForm = new FormData();
    faceMatchForm.append("user_image", new Blob([liveSelfieBytes as BlobPart], { type: liveSelfieMime }), "selfie.jpg");
    faceMatchForm.append("ref_image", new Blob([profilePhotoBytes as BlobPart], { type: profilePhotoMime }), "profile.jpg");
    faceMatchForm.append("face_match_score_decline_threshold", String(faceMatchThreshold));
    faceMatchForm.append("rotate_image", "true");
    faceMatchForm.append("save_api_request", "false");

    const faceMatchResult = await callDiditApi("/face-match/", faceMatchForm, apiKey);

    if (faceMatchResult.status !== 200) {
      console.error("[didit-biometric] face-match error", faceMatchResult.status, faceMatchResult.data);
      return { passed: false, failureCode: "PROVIDER_ERROR", livenessScore };
    }

    const faceMatchData = faceMatchResult.data as {
      face_match: {
        status: "Approved" | "Declined";
        score: number | null;
        warnings: Array<{ risk: string; log_type: string }>;
      };
    };

    if (faceMatchData.face_match.status === "Declined") {
      const failureCode = mapFaceMatchWarnings(faceMatchData.face_match.warnings) ?? "FACE_MATCH_FAILED";
      return {
        passed: false,
        failureCode,
        livenessScore,
        faceMatchScore: faceMatchData.face_match.score ?? undefined,
      };
    }

    const faceMatchScore = faceMatchData.face_match.score ?? 0;

    return { passed: true, livenessScore, faceMatchScore };
  } catch (error) {
    console.error("[didit-biometric] unexpected error", error);
    return { passed: false, failureCode: "PROVIDER_ERROR" };
  }
}

export function getDiditProviderStatus(): { configured: boolean; missing: string[] } {
  return integrations.didit;
}