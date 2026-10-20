import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HttpError, route, type SessionInfo } from "../lib/api";

beforeAll(() => {
  process.env.APP_URL = "http://localhost:3000";
});

const as = (role: SessionInfo["role"]) => async () => ({ userId: "u1", workspaceId: "w1", role });
const none = async () => null;
const post = (body: unknown) =>
  new Request("http://x/api/t", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
  });
const body = z.strictObject({ name: z.string().min(1) });

describe("route()", () => {
  it("passes dynamic route params to the handler", async () => {
    const h = route({}, async ({ params }) => ({ id: params.id }), as("VIEWER"));
    const res = await h(new Request("http://x/api/t/abc/"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(await res.json()).toEqual({ id: "abc" });
  });

  it("unauthenticated -> 401", async () => {
    const h = route({ body }, async () => ({}), none);
    const res = await h(post({ name: "a" }));
    expect(res.status).toBe(401);
  });

  it("VIEWER on write -> 403, VIEWER on GET ok", async () => {
    const w = route({ body }, async () => ({}), as("VIEWER"));
    expect((await w(post({ name: "a" }))).status).toBe(403);
    const r = route({}, async () => ({ ok: 1 }), as("VIEWER"));
    expect((await r(new Request("http://x/api/t"))).status).toBe(200);
  });

  it("unknown body property -> 400", async () => {
    const h = route({ body }, async () => ({}), as("MEMBER"));
    expect((await h(post({ name: "a", extra: 1 }))).status).toBe(400);
  });

  it("bad body -> 400 with issue path", async () => {
    const h = route({ body }, async () => ({}), as("MEMBER"));
    const res = await h(post({ name: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).issues[0].path).toEqual(["name"]);
  });

  it("malformed JSON -> 400", async () => {
    const h = route({ body }, async () => ({}), as("MEMBER"));
    const res = await h(
      new Request("http://x/api/t", {
        method: "POST",
        body: "{",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("ok -> 200 JSON with parsed body, query and workspace", async () => {
    const h = route(
      { body, query: z.object({ q: z.string() }) },
      async (ctx) => ({ n: ctx.body.name, q: ctx.query.q, w: ctx.workspaceId, u: ctx.userId }),
      as("MEMBER"),
    );
    const req = new Request("http://x/api/t?q=z", {
      method: "POST",
      body: JSON.stringify({ name: "a" }),
      headers: { origin: "http://localhost:3000" },
    });
    const res = await h(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ n: "a", q: "z", w: "w1", u: "u1" });
  });

  it("HttpError maps to {error}; unknown error -> 500 and is logged", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = route(
      {},
      async () => {
        throw new HttpError(404, "nope");
      },
      as("OWNER"),
    );
    const res = await a(new Request("http://x/"));
    expect([res.status, await res.json()]).toEqual([404, { error: "nope" }]);
    const b = route(
      {},
      async () => {
        throw new Error("boom");
      },
      as("OWNER"),
    );
    const res2 = await b(new Request("http://x/"));
    expect([res2.status, await res2.json()]).toEqual([500, { error: "Internal error" }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("public needs no session; session-or-apikey without a valid key -> 401 (P1-T07 seam)", async () => {
    const pub = route({ auth: "public" }, async () => ({ hi: 1 }), none);
    expect((await pub(new Request("http://x/"))).status).toBe(200);
    const key = route(
      { auth: "session-or-apikey", scope: "leads:read" },
      async () => ({}),
      none,
      none,
    );
    expect(
      (await key(new Request("http://x/", { headers: { authorization: "Bearer rn_x" } }))).status,
    ).toBe(401);
  });

  it("session writes need a matching Origin (or Referer); GET and API keys are exempt", async () => {
    const h = route({}, async () => ({ ok: 1 }), as("OWNER"));
    const w = (headers: Record<string, string>) =>
      h(new Request("http://x/api/t", { method: "POST", headers }));
    expect((await w({})).status).toBe(403);
    expect((await w({ origin: "https://evil.example" })).status).toBe(403);
    expect((await w({ origin: "http://localhost:3000" })).status).toBe(200);
    expect((await w({ referer: "http://localhost:3000/settings" })).status).toBe(200);
    expect((await w({ referer: "https://evil.example/x" })).status).toBe(403);
    expect(
      (await w({ origin: "https://evil.example", referer: "http://localhost:3000/" })).status,
    ).toBe(403);
    expect((await h(new Request("http://x/api/t"))).status).toBe(200);
    const k = route(
      { auth: "session-or-apikey", scope: "a:write" },
      async () => ({}),
      none,
      async () => ({ workspaceId: "w1", role: "MEMBER" }),
    );
    const kr = new Request("http://x/", { method: "POST", headers: { authorization: "Bearer k" } });
    expect((await k(kr)).status).toBe(200);
  });

  it("public handler context has no workspaceId", async () => {
    const pub = route({ auth: "public" }, async (ctx) => ({ has: "workspaceId" in ctx }), none);
    expect(await (await pub(new Request("http://x/"))).json()).toEqual({ has: false });
  });
});
