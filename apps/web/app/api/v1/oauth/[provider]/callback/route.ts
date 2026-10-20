import { completeOAuth, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { z } from "zod";
import { HttpError, route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

const query = z.object({
  state: z.string().max(200).optional(),
  code: z.string().max(2000).optional(),
  error: z.string().max(200).optional(),
});

// Static page: nothing from the request is reflected. The opener polls /oauth/sessions/:id for the result;
// without an opener (popup blocked, full-page flow) it goes back to the accounts list, which does the same.
const PAGE = `<!doctype html><meta charset="utf-8"><title>Connecting</title><p>Finishing up. You can close this window.</p><script>if(window.opener){window.close()}else{location.replace("/accounts")}</script>`;

/**
 * This is a cross-site top-level redirect from Google, so the session cookie must stay SameSite=Lax
 * (never Strict) or the user would look signed out here. The same user that started the flow must finish it.
 */
export const GET = route(
  { role: "ADMIN", query },
  async ({ workspaceId, userId, query, params }) => {
    if (params.provider !== "google" && params.provider !== "microsoft")
      throw new HttpError(404, "Unknown provider");
    await completeOAuth(prisma, systemClock, {}, { workspaceId, userId: userId!, ...query });
    return new Response(PAGE, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  },
);
