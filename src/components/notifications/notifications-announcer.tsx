"use client";

import { useEffect } from "react";
import { announceNotificationsChanged } from "./notification-item";

// The conversation page marks its messages read during render; tell the bell and
// notification centre to refetch their counts as soon as the chat is on screen.
export function NotificationsAnnouncer() {
  useEffect(() => {
    announceNotificationsChanged();
  }, []);
  return null;
}
