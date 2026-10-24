import { deleteStage, updateStage, stagePatch } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

export const PATCH = route({ auth: "session", role: "ADMIN", body: stagePatch }, (c) =>
  run(async () => ({
    stages: await updateStage(prisma, c.workspaceId, c.userId, c.params.id!, c.body),
  })),
);

export const DELETE = route(
  {
    auth: "session",
    role: "ADMIN",
    query: z.object({ moveTo: z.string().min(1).optional() }),
  },
  (c) => run(() => deleteStage(prisma, c.workspaceId, c.userId, c.params.id!, c.query.moveTo)),
);
