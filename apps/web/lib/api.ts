import { z } from "zod";
import { getWebEnv } from "./env";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const ROLES = ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const;
export type Role = (typeof ROLES)[number];
export type SessionInfo = { userId?: string; workspaceId: string; role: Role };
export type SessionGetter = (req: Request) => Promise<SessionInfo | null>;

type Auth = "session" | "session-or-apikey" | "public";
type Opts<B extends z.ZodType, Q extends z.ZodType, A extends Auth> = {
  body?: B;
  query?: Q;
  auth?: A;
  /** Minimum role. Default VIEWER for GET/HEAD, MEMBER otherwise. */
  role?: Role;
  /** API key scope, e.g. "leads:read". */
  scope?: string;
};
type Ctx<B extends z.ZodType, Q extends z.ZodType, A extends Auth> = {
  userId?: string;
  body: z.infer<B>;
  query: z.infer<Q>;
  /** Next dynamic segments, e.g. `params.id` in `[id]/route.ts`. */
  params: Record<string, string | undefined>;
  req: Request;
} & (A extends "public" ? unknown : { workspaceId: string });

export type ApiKeyResolver = (req: Request, scope?: string) => Promise<SessionInfo | null>;

/** Verifies a workspace API key (Authorization: Bearer) for `scope`: null = no valid key (401), HttpError(403) = scope missing. */
export const resolveApiKey: ApiKeyResolver = async (req, scope) =>
  (await import("./apikey-auth")).apiKeyResolver((await import("@rightnow/db")).prisma)(req, scope);

async function defaultGetSession(req: Request) {
  return (await import("./workspace")).getSessionInfo(req.headers);
}

/** CSRF defence for cookie sessions: Origin (else Referer) must be APP_URL's origin. Missing both fails closed. */
function sameOrigin(req: Request) {
  const given = req.headers.get("origin") ?? req.headers.get("referer");
  try {
    return new URL(given!).origin === new URL(getWebEnv().APP_URL).origin;
  } catch {
    return false;
  }
}

export function route<
  B extends z.ZodType = z.ZodUndefined,
  Q extends z.ZodType = z.ZodUndefined,
  A extends Auth = "session",
>(
  opts: Opts<B, Q, A>,
  handler: (ctx: Ctx<B, Q, A>) => Promise<unknown>,
  getSession: SessionGetter = defaultGetSession,
  keyResolver: ApiKeyResolver = resolveApiKey,
) {
  return async (
    req: Request,
    rc?: { params: Promise<Record<string, string | undefined>> },
  ): Promise<Response> => {
    try {
      const auth = opts.auth ?? "session";
      let info: SessionInfo | null = null;
      if (auth !== "public") {
        const read = req.method === "GET" || req.method === "HEAD";
        info = await getSession(req);
        if (info && !read && !sameOrigin(req))
          throw new HttpError(403, "Cross-origin request blocked");
        if (!info && auth === "session-or-apikey") info = await keyResolver(req, opts.scope);
        if (!info) throw new HttpError(401, "Unauthorized");
        const min = opts.role ?? (read ? "VIEWER" : "MEMBER");
        if (ROLES.indexOf(info.role) < ROLES.indexOf(min)) throw new HttpError(403, "Forbidden");
      }
      let body: unknown;
      if (opts.body) {
        const raw: unknown = await req.json().catch(() => {
          throw new HttpError(400, "Body must be valid JSON");
        });
        body = opts.body.parse(raw);
      }
      const query = opts.query
        ? opts.query.parse(Object.fromEntries(new URL(req.url).searchParams))
        : undefined;
      const out = await handler({
        userId: info?.userId,
        ...(info && { workspaceId: info.workspaceId }),
        body,
        query,
        params: (await rc?.params) ?? {},
        req,
      } as Ctx<B, Q, A>);
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof z.ZodError)
        return Response.json({ error: "Invalid request", issues: e.issues }, { status: 400 });
      console.error("Unhandled API error", e);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
