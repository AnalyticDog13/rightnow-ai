import { MAX_ATTACHMENTS_BYTES, createProvider, sendReply, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../../lib/accounts-http";
import { HttpError, route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

const OVERHEAD = 512 * 1024; // the html body and the small fields

const list = (v: FormDataEntryValue | null) => {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v) as string[];
  } catch {
    throw new HttpError(400, "to and cc must be JSON arrays");
  }
};

/** multipart: mode, html, to and cc (JSON arrays, optional), attachments (files). The size is checked from Content-Length before the body is read. */
export const POST = route({ auth: "session-or-apikey", scope: "inbox:write" }, async (c) => {
  const len = Number(c.req.headers.get("content-length"));
  if (!c.req.headers.has("content-length") || !Number.isFinite(len))
    throw new HttpError(411, "Content-Length required");
  if (len > MAX_ATTACHMENTS_BYTES + OVERHEAD) throw new HttpError(413, "attachments_too_large");
  const form = await c.req.formData().catch(() => {
    throw new HttpError(400, "Body must be multipart/form-data");
  });
  const files = form.getAll("attachments").filter((f): f is File => f instanceof File);
  const attachments = await Promise.all(
    files.map(async (f) => ({
      filename: f.name || "attachment",
      contentType: f.type || "application/octet-stream",
      content: Buffer.from(await f.arrayBuffer()),
    })),
  );
  return run(() =>
    sendReply(
      prisma,
      systemClock,
      { providerFor: async (a) => createProvider(a, { prisma, clock: systemClock }) },
      c.workspaceId,
      c.userId,
      {
        threadId: c.params.id!,
        mode: form.get("mode") as "reply",
        to: list(form.get("to")),
        cc: list(form.get("cc")),
        html: String(form.get("html") ?? ""),
        attachments,
      },
    ),
  );
});
