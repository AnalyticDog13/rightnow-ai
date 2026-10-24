/** Builds docs/openapi.json from the `meta` every `route()` attaches (D45). Run: `npm run openapi`. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "apps/web/app/api/v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Json = Record<string, unknown>;
export const toJson = (s: z.ZodType): Json =>
  z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Json;

export const routeFiles = () =>
  (readdirSync(apiDir, { recursive: true }) as string[])
    .filter((f) => f.endsWith("route.ts") && !f.split(sep).some((s) => s.startsWith("%5F")))
    .sort();

export const apiPath = (file: string) =>
  "/" +
  dirname(file)
    .split(sep)
    .join("/")
    .replace(/\[(\w+)\]/g, "{$1}");

/** Minimum role for a handler: GET/HEAD default VIEWER, everything else MEMBER (see `route()`). */
export const roleOf = (method: string, role?: string) =>
  role ?? (method === "GET" ? "VIEWER" : "MEMBER");

export async function loadRoutes() {
  // The Dockerfile build does the same: route modules import the DB client at load time.
  process.env.DATABASE_URL ??= "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  const out: { path: string; method: string; meta: import("../apps/web/lib/api").RouteMeta }[] = [];
  for (const f of routeFiles()) {
    const mod = (await import(pathToFileURL(join(apiDir, f)).href)) as Record<
      string,
      { meta?: import("../apps/web/lib/api").RouteMeta }
    >;
    for (const m of METHODS) {
      const h = mod[m];
      if (!h) continue;
      if (!h.meta) throw new Error(`${relative(root, join(apiDir, f))} ${m} is not a route()`);
      out.push({ path: apiPath(f), method: m, meta: h.meta });
    }
  }
  return out;
}

export async function buildOpenApi(): Promise<Json> {
  const paths: Record<string, Record<string, Json>> = {};
  for (const { path, method, meta } of await loadRoutes()) {
    const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    if (meta.query) {
      const q = toJson(meta.query);
      const req = (q.required as string[] | undefined) ?? [];
      for (const [name, schema] of Object.entries((q.properties as Json) ?? {}))
        parameters.push({ name, in: "query", required: req.includes(name), schema } as never);
    }
    paths[path] ??= {};
    paths[path][method.toLowerCase()] = {
      security:
        meta.auth === "public"
          ? []
          : meta.auth === "session"
            ? [{ session: [] }]
            : [{ session: [] }, { apiKey: [] }],
      "x-role": roleOf(method, meta.role),
      ...(meta.scope && { "x-scope": meta.scope }),
      ...(meta.alsoScopes && { "x-also-scopes": meta.alsoScopes }),
      ...(parameters.length && { parameters }),
      ...(meta.body && {
        requestBody: {
          required: true,
          content: { "application/json": { schema: toJson(meta.body) } },
        },
      }),
      // shortcut: no response schemas, add them when a client generator needs them (D45)
      responses: { "200": { description: "OK", content: { "application/json": {} } } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "RightNow AI API", version: "1" },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer" },
        session: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
      },
    },
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
  };
}

const START = "<!-- routes:start -->";
const END = "<!-- routes:end -->";

/** `api` with the route table between the markers rebuilt from `doc` (so it cannot drift from the code). */
export function withRouteTable(api: string, doc: Json): string {
  const paths = doc.paths as Record<string, Record<string, Json>>;
  const rows = Object.entries(paths).flatMap(([path, ops]) =>
    Object.entries(ops).map(([method, op]) => {
      const sec = op.security as unknown[];
      const scope = !sec.length
        ? "public"
        : sec.length === 1
          ? "session only"
          : [op["x-scope"], ...((op["x-also-scopes"] as string[] | undefined) ?? [])]
              .map((s) => `\`${s}\``)
              .join(" or ");
      return `| ${method.toUpperCase()} | \`${path}\` | ${op["x-role"]} | ${scope} |`;
    }),
  );
  const table = ["| Method | Path | Role | Scope |", "|---|---|---|---|", ...rows].join("\n");
  const a = api.indexOf(START);
  const b = api.indexOf(END);
  if (a < 0 || b < a) throw new Error("docs/API.md lost its routes markers");
  return `${api.slice(0, a + START.length)}\n${table}\n${api.slice(b)}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(root, "docs/openapi.json"));
  const doc = await buildOpenApi();
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  // an explicit output path (the drift test) leaves docs/API.md alone
  if (!process.argv[2]) {
    const api = join(root, "docs/API.md");
    writeFileSync(api, withRouteTable(readFileSync(api, "utf8"), doc));
  }
  process.exit(0); // route modules keep handles open
}
