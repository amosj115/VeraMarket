export type FaceFailureCode =
  | "NO_FACE"
  | "LOW_QUALITY"
  | "MULTIPLE_FACES"
  | "NO_MATCH"
  | "LIVENESS_FAILED"
  | "PROVIDER_ERROR";

export const FACE_FAILURE_MESSAGES: Record<FaceFailureCode, string> = {
  NO_FACE: "Your face wasn't clearly visible.",
  LOW_QUALITY: "The lighting or image quality was too low.",
  MULTIPLE_FACES: "More than one person was visible.",
  NO_MATCH: "Your live photo didn't sufficiently match your profile photo.",
  LIVENESS_FAILED: "We couldn't complete the camera check.",
  PROVIDER_ERROR: "The verification service had a problem. Please try again shortly.",
};

export const MAX_ATTEMPTS_PER_DAY = 5;
export const MIN_SECONDS_BETWEEN_ATTEMPTS = 10;
export const VERIFICATION_PROMPTS = ["Look straight at the camera", "Turn your head slightly to the left", "Turn your head slightly to the right"] as const;
