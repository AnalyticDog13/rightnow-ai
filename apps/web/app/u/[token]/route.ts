import {
  getEnv,
  isSuppressed,
  systemClock,
  unsubscribeKeys,
  unsubscribeLead,
  verifyUnsubscribe,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { route } from "../../../lib/api";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const mask = (e: string) => `${e[0]}***${e.slice(e.indexOf("@"))}`;

function html(status: number, inner: string) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">${inner}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      },
    },
  );
}
const invalid = () => html(400, "<p>This unsubscribe link is invalid.</p>");
const verify = (t: string | undefined) => verifyUnsubscribe(t ?? "", unsubscribeKeys(getEnv()));

// RFC 8058: GET only shows a confirmation, so a link scanner that prefetches the URL cannot unsubscribe anybody.
export const GET = route({ auth: "public" }, async (c) => {
  const p = verify(c.params.token);
  if (!p) return invalid();
  const lead = await prisma.lead.findFirst({
    where: { id: p.l, workspaceId: p.w },
    select: { email: true },
  });
  // an erased lead has no row and is already suppressed by hash
  if (!lead || (await isSuppressed(prisma, p.w, lead.email)))
    return html(200, "<p>You are unsubscribed.</p>");
  return html(
    200,
    `<p>Unsubscribe from emails sent to ${esc(mask(lead.email))}?</p><form method="post" action="/u/${esc(c.params.token!)}"><input type="hidden" name="confirm" value="1"><button type="submit">Unsubscribe</button></form>`,
  );
});

// Mail providers POST here cross-site with no cookies (RFC 8058), so there is no session, origin or body check.
export const POST = route({ auth: "public" }, async (c) => {
  const p = verify(c.params.token);
  if (!p) return invalid();
  const oneClick = (await c.req.text().catch(() => "")).includes("List-Unsubscribe=One-Click");
  await unsubscribeLead(prisma, systemClock, p, oneClick ? "one_click" : "page");
  return html(200, "<p>You have been unsubscribed.</p>");
});
