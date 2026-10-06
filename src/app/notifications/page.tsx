import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NotificationCenter } from "@/components/notifications/notification-center";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/notifications");
  return <NotificationCenter />;
}
