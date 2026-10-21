import { getEnv, recordOpen, systemClock, trackingKeys, verifyTrack } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

const GIF = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

// Always the same image: a bad token must not tell a scanner anything.
export const GET = route({ auth: "public" }, async (c) => {
  const p = verifyTrack(c.params.token ?? "", trackingKeys(getEnv()));
  if (p) await recordOpen(prisma, systemClock, p, c.req.headers.get("user-agent")).catch(() => {});
  return new Response(GIF, {
    headers: { "content-type": "image/gif", "cache-control": "no-store" },
  });
});
