import { exportLeadData } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** PS-LEAD-22: one lead's data as a JSON download (audited `lead.export`). */
export const GET = route({ auth: "session-or-apikey", scope: "leads:read", role: "MEMBER" }, (c) =>
  run(async () => {
    const data = await exportLeadData(prisma, c.workspaceId, c.params.id!, c.userId);
    return new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="lead-${c.params.id}.json"`,
      },
    });
  }),
);
