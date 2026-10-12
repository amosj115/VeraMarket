import { NextResponse } from "next/server";
import { User } from "@prisma/client";

/**
 * Checks if a user is flagged for review.
 * If flagged, it returns a Forbidden response that blocks restricted activities.
 */
export function enforceReviewStatus(user: User | null) {
  if (!user) {
    return { isBlocked: true, response: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  }

  if (user.flaggedForReview) {
    return {
      isBlocked: true,
      response: NextResponse.json(
        { error: "Your account is currently under review. You cannot create or publish new content at this time. Please contact support if you believe this is an error." },
        { status: 403 }
      )
    };
  }

  return { isBlocked: false };
}
