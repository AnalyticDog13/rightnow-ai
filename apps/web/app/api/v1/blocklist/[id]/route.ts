import { removeBlocklist } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

const body = z.strictObject({
  confirm: z.boolean().optional(), // HARD_BOUNCE
  resubscribeAttestation: z // UNSUBSCRIBE: why, and that the recipient consented
    .strictObject({ reason: z.string().trim().min(1).max(500), recipientConsent: z.literal(true) })
    .optional(),
});

/** ADMIN only (API keys act as MEMBER, so they cannot). Rules per reason: see `removeBlocklist` (D20). Send `{}` for a plain entry. */
export const DELETE = route(
  { auth: "session-or-apikey", scope: "blocklist:delete", role: "ADMIN", body },
  (c) => run(() => removeBlocklist(prisma, c.workspaceId, c.userId, c.params.id!, c.body)),
);
