import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ProfileOnboarding } from "@/components/profile/profile-onboarding";

export const dynamic = "force-dynamic";

export default async function OnboardingProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/onboarding/profile");
  return <ProfileOnboarding />;
}
