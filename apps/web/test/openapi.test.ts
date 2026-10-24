import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
const committed = () => JSON.parse(readFileSync(join(root, "docs/openapi.json"), "utf8"));

/** Handlers that deliberately take no API key. Everything else at VIEWER/MEMBER level needs a scope. */
const SESSION_ONLY: Record<string, string> = {
  "GET /oauth/sessions/{id}": "polled by the browser tab that started the OAuth connect",
};

/** Objects that stay open on purpose: rule actions are validated per `type` by the engine's ACTIONS table. */
const OPEN_BY_DESIGN = new Set(["#/properties/actions/items"]);

/** JSON-Schema paths of object nodes (unions included) that still accept unknown keys. */
function looseObjects(node: unknown, at = "#"): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => looseObjects(n, `${at}/${i}`));
  if (!node || typeof node !== "object") return [];
  const o = node as Record<string, unknown>;
  const own = o.properties && o.additionalProperties !== false ? [at] : [];
  return [...own, ...Object.entries(o).flatMap(([k, v]) => looseObjects(v, `${at}/${k}`))];
}

let db: Awaited<ReturnType<typeof createTestDb>>;
let script: typeof import("../../../scripts/openapi");
let routes: Awaited<ReturnType<typeof script.loadRoutes>>;

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local",
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-web-")),
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
  });
  script = await import("../../../scripts/openapi");
  routes = await script.loadRoutes();
}, 120_000);
afterAll(() => db.drop());

describe("openapi document", () => {
  it("drift: regenerating (with no DATABASE_URL) equals docs/openapi.json", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "rn-oa-")), "openapi.json");
    const env = { ...process.env };
    delete env.DATABASE_URL;
    execFileSync(
      process.execPath,
      [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "scripts/openapi.ts"), out],
      { cwd: root, env, stdio: "pipe", timeout: 100_000 },
    );
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(committed());
    expect(await script.buildOpenApi()).toEqual(committed());
  }, 120_000);

  it("coverage: every route.ts method is a path (no %5F routes)", () => {
    const dir = join(root, "apps/web/app/api/v1");
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) =>
      f.endsWith("route.ts"),
    );
    expect(files.length).toBeGreaterThan(100);
    const doc = committed();
    for (const f of files) {
      const path =
        "/" +
        dirname(f)
          .split(sep)
          .join("/")
          .replace(/\[(\w+)\]/g, "{$1}");
      if (f.startsWith("%5F")) {
        expect(doc.paths[path]).toBeUndefined();
        continue;
      }
      const methods = [
        ...readFileSync(join(dir, f), "utf8").matchAll(
          /export const (GET|POST|PUT|PATCH|DELETE)\b/g,
        ),
      ];
      expect(methods.length, f).toBeGreaterThan(0);
      for (const [, m] of methods)
        expect(doc.paths[path]?.[m!.toLowerCase()], `${m} ${path}`).toBeDefined();
    }
  });

  it("served: GET /api/v1/openapi.json is public", async () => {
    const { GET } = await import("../app/api/v1/openapi.json/route");
    const r = await GET(new Request(`${ORIGIN}/api/v1/openapi.json`));
    expect(r.status).toBe(200);
    expect((await r.json()).openapi).toBe("3.1.0");
  });
});

describe("request bodies", () => {
  const bodies = () => routes.filter((r) => r.meta.body);

  it("no route body is z.unknown()", () => {
    expect(bodies().length).toBeGreaterThan(40);
    for (const r of bodies()) {
      const s = script.toJson(r.meta.body!);
      expect(s.type === "object" || s.anyOf || s.oneOf, `${r.method} ${r.path}`).toBeTruthy();
    }
  });

  it("strict: every object branch of every body rejects unknown keys", () => {
    for (const r of bodies()) {
      const loose = looseObjects(script.toJson(r.meta.body!)).filter((p) => !OPEN_BY_DESIGN.has(p));
      expect(loose, `${r.method} ${r.path}`).toEqual([]);
    }
  });

  it("strict detector fails on a loose union branch", () => {
    const loose = z.union([z.strictObject({ a: z.string() }), z.object({ b: z.string() })]);
    expect(looseObjects(script.toJson(loose))).toEqual(["#/anyOf/1"]);
  });

  it("an unknown key on POST /lead-lists is a 400", async () => {
    const { auth } = await import("../lib/auth");
    const { workspaceId } = await createFirstOwner(
      db.prisma,
      { name: "O", email: "owner@x.io", password: PASSWORD, workspaceName: "Acme", token: TOKEN },
      TOKEN,
    );
    expect(workspaceId).toBeTruthy();
    const { headers } = await auth.api.signInEmail({
      body: { email: "owner@x.io", password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const { POST } = await import("../app/api/v1/lead-lists/route");
    const post = (body: object) =>
      POST(
        new Request(`${ORIGIN}/api/v1/lead-lists`, {
          method: "POST",
          headers: { origin: ORIGIN, cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect((await post({ name: "x", bogus: 1 })).status).toBe(400);
    expect((await post({ name: "x" })).status).toBe(200);
  });
});

describe("scope audit", () => {
  it("every VIEWER/MEMBER handler takes an API key with a scope that exists", async () => {
    const { API_SCOPES: scopes } = await import("@rightnow/core");
    const known = (s: string) => {
      const [res, verb] = s.split(":");
      return (
        (scopes as readonly string[]).includes(s) ||
        (["create", "update", "delete"].includes(verb!) &&
          (scopes as readonly string[]).includes(`${res}:write`))
      );
    };
    const ranks = ["VIEWER", "MEMBER", "ADMIN", "OWNER"];
    for (const { method, path, meta } of routes) {
      const key = `${method} ${path}`;
      if (meta.auth === "public") continue;
      const role = script.roleOf(method, meta.role);
      if (ranks.indexOf(role) > 1) {
        // API keys act as MEMBER: an ADMIN handler is unreachable with one (403) or is session-only.
        expect(meta.auth === "session" || role === "ADMIN" || role === "OWNER", key).toBe(true);
        continue;
      }
      if (SESSION_ONLY[key]) {
        expect(meta.auth, key).toBe("session");
        continue;
      }
      expect(meta.auth, key).toBe("session-or-apikey");
      expect(meta.scope && known(meta.scope), `${key} scope ${meta.scope}`).toBe(true);
    }
  });

  it("session-only exceptions are real routes", () => {
    for (const k of Object.keys(SESSION_ONLY))
      expect(
        routes.some((r) => `${r.method} ${r.path}` === k),
        k,
      ).toBe(true);
  });
});
