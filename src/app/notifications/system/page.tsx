import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SystemNotificationCenter } from "@/components/notifications/system-notifications";

export const dynamic = "force-dynamic";

export default async function SystemNotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/notifications/system");
  return <SystemNotificationCenter />;
}
