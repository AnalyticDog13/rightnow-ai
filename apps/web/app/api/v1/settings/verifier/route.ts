import {
  getVerifierSettings,
  setVerifierSettings,
  systemClock,
  verifierInput,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../lib/accounts-http";
import { route } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "session", role: "ADMIN" }, (c) =>
  getVerifierSettings(prisma, c.workspaceId),
);

export const PUT = route({ auth: "session", role: "ADMIN", body: verifierInput }, (c) =>
  run(() => setVerifierSettings(prisma, systemClock, c.workspaceId, c.userId, c.body)),
);
