import { reviewSuggestion, suggestionReview, systemClock } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { run } from "../../../../../../lib/accounts-http";
import { route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Approve or reject: the only way AI text leaves PENDING (D47). MEMBER; a VIEWER gets 403. */
export const PATCH = route(
  { auth: "session-or-apikey", scope: "ai:write", body: suggestionReview },
  (c) =>
    run(() =>
      reviewSuggestion(prisma, systemClock, c.workspaceId, c.userId, c.params.id!, c.body.status),
    ),
);
