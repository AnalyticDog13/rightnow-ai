import { z } from "zod";

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

type Opts<B extends z.ZodType, Q extends z.ZodType> = {
  body?: B;
  query?: Q;
  auth?: "session" | "session-or-apikey" | "public";
  /** Minimum role. Default VIEWER for GET/HEAD, MEMBER otherwise. */
  role?: Role;
  /** API key scope, e.g. "leads:read". */
  scope?: string;
};
type Ctx<B extends z.ZodType, Q extends z.ZodType> = {
  userId?: string;
  /** Empty string on auth: "public" routes. */
  workspaceId: string;
  body: z.infer<B>;
  query: z.infer<Q>;
  req: Request;
};

/** P1-T07 seam: verify a workspace API key (Authorization: Bearer) for `scope`. Until then no key is valid. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature is the contract P1-T07 fills
export async function resolveApiKey(_req: Request, _scope?: string): Promise<SessionInfo | null> {
  return null;
}

async function defaultGetSession(req: Request) {
  return (await import("./workspace")).getSessionInfo(req.headers);
}

export function route<B extends z.ZodType = z.ZodUndefined, Q extends z.ZodType = z.ZodUndefined>(
  opts: Opts<B, Q>,
  handler: (ctx: Ctx<B, Q>) => Promise<unknown>,
  getSession: SessionGetter = defaultGetSession,
) {
  return async (req: Request): Promise<Response> => {
    try {
      const auth = opts.auth ?? "session";
      let info: SessionInfo | null = null;
      if (auth !== "public") {
        info = await getSession(req);
        if (!info && auth === "session-or-apikey") info = await resolveApiKey(req, opts.scope);
        if (!info) throw new HttpError(401, "Unauthorized");
        const read = req.method === "GET" || req.method === "HEAD";
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
        workspaceId: info?.workspaceId ?? "",
        body,
        query,
        req,
      } as Ctx<B, Q>);
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
