import { exportLeadsCsv, leadQuery } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Pulls one CSV chunk per read, so a large export never sits in memory. */
function csvStream(chunks: AsyncIterable<string>) {
  const it = chunks[Symbol.asyncIterator]();
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      const r = await it.next();
      if (r.done) ctl.close();
      else ctl.enqueue(enc.encode(r.value));
    },
    cancel: () => void it.return?.(),
  });
}

export const GET = route(
  { auth: "session-or-apikey", scope: "leads:read", query: leadQuery },
  async ({ workspaceId, query }) =>
    new Response(csvStream(exportLeadsCsv(prisma, workspaceId, query)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="leads.csv"',
      },
    }),
);
