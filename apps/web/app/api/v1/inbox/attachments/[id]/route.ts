import { getAttachment } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { HttpError, route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

const TYPE = /^[\w.+-]+\/[\w.+-]+$/;

/** Always a download, never rendered: attachment disposition, nosniff and a sandboxing CSP. */
export const GET = route({ auth: "session-or-apikey", scope: "inbox:read" }, async (c) => {
  const a = await getAttachment(prisma, c.workspaceId, c.params.id!);
  if (!a) throw new HttpError(404, "Not found");
  if (!a.data) throw new HttpError(410, "Attachment was too large to store");
  const ascii = a.filename.replace(/[^\w.\- ]/g, "_");
  return new Response(Buffer.from(a.data), {
    headers: {
      "Content-Type": TYPE.test(a.contentType) ? a.contentType : "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
});
