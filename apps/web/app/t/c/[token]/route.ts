import { getEnv, recordClick, systemClock, trackingKeys, verifyTrack } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

const invalid = () =>
  new Response("This link is invalid.", {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

export const GET = route({ auth: "public" }, async (c) => {
  const p = verifyTrack(c.params.token ?? "", trackingKeys(getEnv()));
  let url: URL;
  try {
    url = new URL(p?.u ?? "");
  } catch {
    return invalid();
  }
  if (!p?.u || !["http:", "https:"].includes(url.protocol)) return invalid();
  await recordClick(prisma, systemClock, p, c.req.headers.get("user-agent")).catch(() => {});
  return new Response(null, {
    status: 302,
    headers: {
      // the signed URL as written, unless it is not a valid header value
      location: /^[\x21-\x7e]+$/.test(p.u) ? p.u : url.href,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
});
