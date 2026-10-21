import type { PrismaClient } from "@rightnow/db/client";

/** Newest threads first, with the latest message. Attachments are metadata only: `data` is read by the download route alone. */
export function listThreads(db: PrismaClient, ws: string, o: { take?: number } = {}) {
  return db.thread.findMany({
    where: { workspaceId: ws, deletedAt: null },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: o.take ?? 50,
    include: {
      messages: {
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: 1,
        include: {
          attachments: {
            select: { id: true, filename: true, contentType: true, size: true, truncated: true },
          },
        },
      },
    },
  });
}
