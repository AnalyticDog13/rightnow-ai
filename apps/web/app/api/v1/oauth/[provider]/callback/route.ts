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

// Static page: nothing from the request is reflected. The main window polls /oauth/sessions/:id for the result.
// Google COOP severs window.opener, so a popup cannot be detected that way: only the full-page flow sets the
// sessionStorage key, and only then do we go back to the app. Otherwise it is a plain "close" page.
const PAGE = `<!doctype html><meta charset="utf-8"><title>Done</title><p>Done. You can close this window and return to rightnow.</p><script>try{if(sessionStorage.getItem("oauth-session")){location.replace("/accounts")}else{window.close()}}catch(e){}</script>`;

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
