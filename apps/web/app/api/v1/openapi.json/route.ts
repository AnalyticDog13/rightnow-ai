import { route } from "../../../../lib/api";
import doc from "../../../../../../docs/openapi.json";

export const dynamic = "force-dynamic";

/** The committed document that `npm run openapi` generates; public so client generators can fetch it. */
export const GET = route({ auth: "public" }, async () => doc);
