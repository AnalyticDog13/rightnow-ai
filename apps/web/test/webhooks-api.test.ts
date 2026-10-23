import { mkdtempSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectIsolated } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let readKey: string;
let writeKey: string;
let inboxKey: string;
let server: http.Server;
let hits = 0;
let list: typeof import("../app/api/v1/webhooks/route");
let one: typeof import("../app/api/v1/webhooks/[id]/route");
let testRoute: typeof import("../app/api/v1/webhooks/[id]/test/route");
let resume: typeof import("../app/api/v1/webhooks/[id]/resume/route");
let rotate: typeof import("../app/api/v1/webhooks/[id]/rotate-secret/route");
let deliveries: typeof import("../app/api/v1/webhooks/[id]/deliveries/route");
let redeliver: typeof import("../app/api/v1/webhooks/deliveries/[id]/redeliver/route");
let overview: typeof import("../app/api/v1/webhooks/overview/route");

const req = (
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = { cookie },
) =>
  new Request(`${ORIGIN}/api/v1/${url}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
const target = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
const mk = (b: Record<string, unknown>, h?: Record<string, string>) =>
  list.POST(req("POST", "webhooks", { url: target(), events: ["email_sent"], ...b }, h));
const keyWith = async (scopes: string[]) => {
  const { createApiKey } = await import("@rightnow/core");
  return (await createApiKey(db.prisma, workspaceId, scopes.join(","), scopes)).token;
};

beforeAll(async () => {
  db = await createTestDb();
  server = http.createServer((q, s) => {
    hits++;
    q.resume();
    s.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    MODE: "local",
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-web-")),
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
    ALLOW_PRIVATE_HTTP_HOSTS: "1", // the target is this test's loopback server
  });
  const { auth } = await import("../lib/auth");
  list = await import("../app/api/v1/webhooks/route");
  one = await import("../app/api/v1/webhooks/[id]/route");
  testRoute = await import("../app/api/v1/webhooks/[id]/test/route");
  resume = await import("../app/api/v1/webhooks/[id]/resume/route");
  rotate = await import("../app/api/v1/webhooks/[id]/rotate-secret/route");
  deliveries = await import("../app/api/v1/webhooks/[id]/deliveries/route");
  redeliver = await import("../app/api/v1/webhooks/deliveries/[id]/redeliver/route");
  overview = await import("../app/api/v1/webhooks/overview/route");
  ({ workspaceId } = await createFirstOwner(
    db.prisma,
    { name: "O", email: "owner@x.io", password: PASSWORD, workspaceName: "Acme", token: TOKEN },
    TOKEN,
  ));
  const { headers } = await auth.api.signInEmail({
    body: { email: "owner@x.io", password: PASSWORD },
    returnHeaders: true,
  });
  cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  readKey = await keyWith(["webhooks:read"]);
  writeKey = await keyWith(["webhooks:write"]);
  inboxKey = await keyWith(["webhooks:write", "inbox:read"]);
});
afterAll(async () => {
  server.close();
  await db.drop();
});

describe("webhook routes", () => {
  it("create shows the secret once; reads never do; scopes and the reply-body rule apply", async () => {
    expect((await mk({}, bearer(readKey))).status).toBe(403);
    const ok = await mk({ headers: { "X-Token": "abc" } }, bearer(writeKey));
    expect(ok.status).toBe(200);
    const w = (await json(ok)) as { id: string; secret: string };
    expect(w.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

    const got = await json(
      await one.GET(req("GET", `webhooks/${w.id}`, undefined, bearer(readKey)), p(w.id)),
    );
    expect(got).toMatchObject({ id: w.id, hasSecret: true, headerNames: ["X-Token"] });
    expect(JSON.stringify(got)).not.toContain("whsec_");
    expect(JSON.stringify(got)).not.toContain("abc");
    const all = await json(await list.GET(req("GET", "webhooks", undefined, bearer(readKey))));
    expect(JSON.stringify(all)).not.toContain("whsec_");

    // R12: reply events need inbox:read as well, on create and on patch
    expect(await json(await mk({ events: ["all_events"] }, bearer(writeKey)))).toMatchObject({
      error: "scope_required:inbox:read",
    });
    const patch = (b: unknown, h: Record<string, string>) =>
      one.PATCH(req("PATCH", `webhooks/${w.id}`, b, h), p(w.id));
    expect((await patch({ events: ["reply_received"] }, bearer(writeKey))).status).toBe(403);
    expect((await patch({ events: ["reply_received"] }, bearer(inboxKey))).status).toBe(200);
    expect((await patch({ bogus: 1 }, { cookie })).status).toBe(400);
    expect((await patch({ events: ["nope_event"] }, { cookie })).status).toBe(400);
    expect((await mk({ headers: { Host: "evil" } })).status).toBe(400);
    expect((await mk({ url: "ftp://x.test/" })).status).toBe(400);

    const rot = await json(
      await rotate.POST(req("POST", `webhooks/${w.id}/rotate-secret`), p(w.id)),
    );
    expect(rot.secret).toMatch(/^whsec_/);
    expect(rot.secret).not.toBe(w.secret);

    const del = (h?: Record<string, string>) =>
      one.DELETE(req("DELETE", `webhooks/${w.id}`, undefined, h), p(w.id));
    expect((await del(bearer(readKey))).status).toBe(403);
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(404);
  });

  it("test posts to the target; resume and redeliver work; deliveries page", async () => {
    const w = (await json(await mk({}))) as { id: string };
    const before = hits;
    expect(
      await json(await testRoute.POST(req("POST", `webhooks/${w.id}/test`), p(w.id))),
    ).toMatchObject({ status: 200, error: null });
    expect(hits).toBe(before + 1);

    await db.prisma.webhook.update({
      where: { id: w.id },
      data: { status: "ERROR", consecutiveFailures: 20, disabledAt: new Date(), lastError: "x" },
    });
    expect(
      await json(await resume.POST(req("POST", `webhooks/${w.id}/resume`), p(w.id))),
    ).toMatchObject({ status: "ACTIVE", consecutiveFailures: 0 });

    const mkDelivery = (n: number, status: "FAILED" | "PENDING") =>
      db.prisma.webhookDelivery.create({
        data: {
          workspaceId,
          webhookId: w.id,
          eventId: `e${n}`,
          eventType: "email_sent",
          payload: { event_id: `e${n}` },
          status,
          nextAttemptAt: new Date(),
          createdAt: new Date(2026, 0, n),
        },
      });
    const failed = await mkDelivery(1, "FAILED");
    await mkDelivery(2, "PENDING");
    await mkDelivery(3, "PENDING");
    const page = (q: string) =>
      deliveries.GET(
        req("GET", `webhooks/${w.id}/deliveries${q}`, undefined, bearer(readKey)),
        p(w.id),
      );
    const ids = (r: Record<string, unknown>) =>
      (r.deliveries as { eventId: string }[]).map((d) => d.eventId);
    const first = await json(await page("?take=2"));
    expect(ids(first)).toEqual(["e3", "e2"]);
    const next = await json(await page(`?take=2&cursor=${first.nextCursor}`));
    expect(ids(next)).toEqual(["e1"]);
    expect((await page("?take=x")).status).toBe(400);
    expect((await page("?status=NOPE")).status).toBe(400);

    const rd = (id: string, h?: Record<string, string>) =>
      redeliver.POST(req("POST", `webhooks/deliveries/${id}/redeliver`, undefined, h), p(id));
    expect((await rd(failed.id, bearer(readKey))).status).toBe(403);
    expect((await rd(failed.id)).status).toBe(200);
    expect(
      (await db.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })).status,
    ).toBe("PENDING");
    expect((await rd(failed.id)).status).toBe(404); // not finished any more
  });

  it("an API key without inbox:read gets no reply or email bodies in deliveries; a session does", async () => {
    const w = (await json(await mk({}))) as { id: string };
    await db.prisma.webhookDelivery.create({
      data: {
        workspaceId,
        webhookId: w.id,
        eventId: "body1",
        eventType: "reply_received",
        status: "DELIVERED",
        nextAttemptAt: new Date(),
        payload: {
          event_type: "reply_received",
          lead_email: "a@b.test",
          reply_text: "secret",
          reply_html: "<p>secret</p>",
          reply_subject: "Re",
          reply_text_snippet: "secret",
          email_text: "body",
          email_html: "<p>body</p>",
        },
      },
    });
    const get = async (h: Record<string, string>) =>
      (
        (await json(
          await deliveries.GET(req("GET", `webhooks/${w.id}/deliveries`, undefined, h), p(w.id)),
        )) as { deliveries: { payload: Record<string, unknown> }[] }
      ).deliveries[0]!.payload;
    expect(await get(bearer(readKey))).toEqual({
      event_type: "reply_received",
      lead_email: "a@b.test",
    });
    expect(await get(bearer(await keyWith(["webhooks:read", "inbox:read"])))).toMatchObject({
      reply_text: "secret",
    });
    expect(await get({ cookie })).toMatchObject({
      reply_text: "secret",
      reply_html: "<p>secret</p>",
      email_html: "<p>body</p>",
    });
  });

  it("overview validates its dates and returns the per-day counts", async () => {
    const q = (s: string) =>
      overview.GET(req("GET", `webhooks/overview${s}`, undefined, bearer(readKey)));
    expect((await q("")).status).toBe(400);
    expect((await q("?from=x&to=y")).status).toBe(400);
    expect(await json(await q("?from=2026-01-01&to=2026-01-31"))).toEqual({ days: [] });
  });

  it("every route is workspace-scoped", async () => {
    const { createWebhook, listWebhooks } = await import("@rightnow/core");
    const input = () => ({ url: target(), events: ["email_sent"] });
    const env = { allowPrivate: true };
    const other = await db.prisma.workspace.create({ data: { name: "X", slug: "x-hooks" } });
    const fw = await createWebhook(db.prisma, other.id, null, input(), env);
    const fd = await db.prisma.webhookDelivery.create({
      data: {
        workspaceId: other.id,
        webhookId: fw.id,
        eventId: "f1",
        eventType: "email_sent",
        status: "FAILED",
        nextAttemptAt: new Date(),
        payload: {},
      },
    });
    const status = async (r: Promise<Response>) => (await r).status;
    expect(
      await Promise.all([
        status(one.GET(req("GET", `webhooks/${fw.id}`), p(fw.id))),
        status(one.PATCH(req("PATCH", `webhooks/${fw.id}`, { name: "x" }), p(fw.id))),
        status(one.DELETE(req("DELETE", `webhooks/${fw.id}`), p(fw.id))),
        status(testRoute.POST(req("POST", `webhooks/${fw.id}/test`), p(fw.id))),
        status(resume.POST(req("POST", `webhooks/${fw.id}/resume`), p(fw.id))),
        status(rotate.POST(req("POST", `webhooks/${fw.id}/rotate-secret`), p(fw.id))),
        status(deliveries.GET(req("GET", `webhooks/${fw.id}/deliveries`), p(fw.id))),
        status(redeliver.POST(req("POST", `webhooks/deliveries/${fd.id}/redeliver`), p(fd.id))),
      ]),
    ).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);
    const mine = (await json(await list.GET(req("GET", "webhooks")))).webhooks as {
      id: string;
    }[];
    expect(mine.map((x) => x.id)).not.toContain(fw.id);
    await expectIsolated({
      prisma: db.prisma,
      seed: (ws) => createWebhook(db.prisma, ws, null, input(), env),
      read: (ws) => listWebhooks(db.prisma, ws),
    });
  });
});
