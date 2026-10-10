import { prisma } from "@/lib/prisma";
import { MESSAGE_NOTIFICATION_TYPES } from "@/lib/notifications";

export type ChatGroupDto = {
  conversationId: string;
  senderId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  count: number;
  preview: string;
  lastMessageAt: string;
  link: string;
};

export type SystemGroupDto = {
  count: number;
  preview: string;
  lastAt: string | null;
  link: string;
};

export type NotificationSummary = {
  chatGroups: ChatGroupDto[];
  system: SystemGroupDto;
  chatUnread: number;
  systemUnread: number;
  totalUnread: number;
};

// Display cap only; totals below always count every unread row.
const MAX_CHAT_GROUPS = 50;

type ConversationRow = {
  id: string;
  userAId: string;
  userA: { id: string; displayName: string; username: string; avatarUrl: string | null };
  userB: { id: string; displayName: string; username: string; avatarUrl: string | null };
  messages: { body: string; createdAt: Date }[];
};

const conversationFilter = (userId: string) => ({ OR: [{ userAId: userId }, { userBId: userId }] });

async function loadConversations(userId: string, ids: string[]): Promise<ConversationRow[]> {
  if (!ids.length) return [];
  return prisma.conversation.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      userAId: true,
      userA: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
      userB: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
      messages: {
        where: { senderId: { not: userId }, readAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, createdAt: true },
      },
    },
  });
}

// Cheap totals for the bell badge: unread messages + unread non-message notifications.
export async function getUnreadTotals(userId: string) {
  const [chatUnread, systemUnread] = await Promise.all([
    prisma.message.count({
      where: { senderId: { not: userId }, readAt: null, conversation: conversationFilter(userId) },
    }),
    prisma.notification.count({ where: { userId, readAt: null, type: { notIn: MESSAGE_NOTIFICATION_TYPES } } }),
  ]);
  return { chatUnread, systemUnread, totalUnread: chatUnread + systemUnread };
}

// Groups are derived from existing records only; no group rows are stored anywhere.
export async function getNotificationSummary(userId: string): Promise<NotificationSummary> {
  const grouped = await prisma.message.groupBy({
    by: ["conversationId"],
    where: { senderId: { not: userId }, readAt: null, conversation: conversationFilter(userId) },
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((row) => [row.conversationId, row._count._all]));
  const chatUnread = grouped.reduce((sum, row) => sum + row._count._all, 0);

  const conversations = await loadConversations(userId, [...counts.keys()]);
  const chatGroups = conversations
    .map((conversation) => {
      const sender = conversation.userAId === userId ? conversation.userB : conversation.userA;
      const latest = conversation.messages[0];
      if (!latest) return null;
      const count = counts.get(conversation.id) ?? 0;
      if (count === 0) return null;
      return {
        conversationId: conversation.id,
        senderId: sender.id,
        displayName: sender.displayName,
        username: sender.username,
        avatarUrl: sender.avatarUrl,
        count,
        preview: latest.body,
        lastMessageAt: latest.createdAt.toISOString(),
        link: `/messages/${conversation.id}`,
      } satisfies ChatGroupDto;
    })
    .filter((group): group is ChatGroupDto => group !== null)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .slice(0, MAX_CHAT_GROUPS);

  const [systemUnread, latestSystem] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null, type: { notIn: MESSAGE_NOTIFICATION_TYPES } } }),
    prisma.notification.findFirst({
      where: { userId, type: { notIn: MESSAGE_NOTIFICATION_TYPES } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { body: true, createdAt: true },
    }),
  ]);

  return {
    chatGroups,
    system: {
      count: systemUnread,
      preview: latestSystem?.body ?? "Updates from Vera Market will appear here.",
      lastAt: latestSystem?.createdAt.toISOString() ?? null,
      link: "/notifications/system",
    },
    chatUnread,
    systemUnread,
    totalUnread: chatUnread + systemUnread,
  };
}
