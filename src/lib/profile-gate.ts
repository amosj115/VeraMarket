import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const profileVerificationEnforced = () => process.env.PROFILE_VERIFICATION_ENFORCED !== "false";

// Reads the DB (not the JWT) so a verification change applies immediately.
export async function requireVerifiedProfile(userId: string) {
  if (!profileVerificationEnforced()) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { profileVerification: true } });
  if (user?.profileVerification === "VERIFIED") return null;
  return NextResponse.json(
    { error: "Profile verification required. Verify that you're really you to use this feature.", code: "PROFILE_VERIFICATION_REQUIRED", verifyUrl: "/onboarding/profile" },
    { status: 403 }
  );
}
