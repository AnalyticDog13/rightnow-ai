import { prisma } from "@rightnow/db";
import { route } from "../../../../lib/api";

export const dynamic = "force-dynamic";

// Caddy on-demand TLS asks before it requests a certificate: only a verified tracking domain gets one.
export const GET = route({ auth: "public" }, async (c) => {
  const domain = new URL(c.req.url).searchParams.get("domain")?.toLowerCase();
  const found =
    !!domain &&
    (await prisma.emailAccount.count({
      where: { trackingDomain: domain, trackingDomainStatus: "VERIFIED", deletedAt: null },
    })) > 0;
  return new Response(null, { status: found ? 200 : 404 });
});
