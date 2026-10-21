import {
  moveToSubsequence,
  pauseCampaignLead,
  removeCampaignLead,
  removeFromSubsequence,
  resumeCampaignLead,
  systemClock,
} from "@rightnow/core";
import { z } from "zod";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../../lib/accounts-http";
import { route } from "../../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const POST = route(
  {
    auth: "session-or-apikey",
    scope: "campaigns:update",
    body: z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("pause") }),
      z.strictObject({ action: z.literal("resume") }),
      z.strictObject({ action: z.literal("remove") }),
      z.strictObject({ action: z.literal("remove_from_subsequence") }),
      z.strictObject({
        action: z.literal("move_to_subsequence"),
        subsequenceId: z.string().min(1),
      }),
    ]),
  },
  (c) =>
    run(async () => {
      const [ws, u, id] = [c.workspaceId, c.userId, c.params.clId!];
      const b = c.body;
      const campaignLead =
        b.action === "pause"
          ? await pauseCampaignLead(prisma, ws, u, id)
          : b.action === "resume"
            ? await resumeCampaignLead(prisma, ws, u, id)
            : b.action === "remove"
              ? await removeCampaignLead(prisma, systemClock, ws, u, id)
              : b.action === "remove_from_subsequence"
                ? await removeFromSubsequence(prisma, systemClock, ws, u, id)
                : await moveToSubsequence(prisma, systemClock, ws, u, id, b.subsequenceId);
      return { campaignLead };
    }),
);
