import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";

const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let core: typeof import("@rightnow/core");
let open: typeof import("../app/t/o/[token]/route");
let click: typeof import("../app/t/c/[token]/route");
let check: typeof import("../app/api/tracking-domain/check/route");
let key: Buffer;
let msgId: string;

const p = (t: string) => ({ params: Promise.resolve({ token: t }) });
const pixel = (t: string) => open.GET(new Request(`${ORIGIN}/t/o/${t}`), p(t));
const go = (t: string) => click.GET(new Request(`${ORIGIN}/t/c/${t}`), p(t));
const events = () => db.prisma.event.count();

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
    SETUP_TOKEN: "t".repeat(20),
  });
  core = await import("@rightnow/core");
  open = await import("../app/t/o/[token]/route");
  click = await import("../app/t/c/[token]/route");
  check = await import("../app/api/tracking-domain/check/route");
  key = core.trackingKeys(core.getEnv())[0]!;
  const w = await db.prisma.workspace.create({ data: { name: "W", slug: "w" } });
  const a = await db.prisma.emailAccount.create({
    data: {
      workspaceId: w.id,
      provider: "SMTP",
      email: "a@send.test",
      fromName: "A",
      firstName: "A",
      lastName: "B",
      capTier: "SMTP",
      providerCap: 100,
      trackingDomain: "track.send.test",
      trackingDomainStatus: "VERIFIED",
    },
  });
  await db.prisma.emailAccount.create({
    data: {
      workspaceId: w.id,
      provider: "SMTP",
      email: "b@send.test",
      fromName: "B",
      firstName: "A",
      lastName: "B",
      capTier: "SMTP",
      providerCap: 100,
      trackingDomain: "pending.send.test",
    },
  });
  const lead = await db.prisma.lead.create({ data: { workspaceId: w.id, email: "l@x.test" } });
  const camp = await db.prisma.campaign.create({ data: { workspaceId: w.id, name: "c" } });
  const step = await db.prisma.sequenceStep.create({
    data: { campaignId: camp.id, order: 1, delayValue: 0 },
  });
  const cl = await db.prisma.campaignLead.create({
    data: { workspaceId: w.id, campaignId: camp.id, leadId: lead.id, state: "ACTIVE" },
  });
  msgId = (
    await db.prisma.scheduledMessage.create({
      data: {
        workspaceId: w.id,
        campaignId: camp.id,
        campaignLeadId: cl.id,
        stepId: step.id,
        accountId: a.id,
        idempotencyKey: "k",
        dueAt: new Date(),
        status: "SENT",
        sentAt: new Date(Date.now() - 3600_000),
        renderedSubject: "s",
        renderedBody: "b",
        renderedText: "b",
      },
    })
  ).id;
});
afterAll(async () => {
  await db.drop();
});

describe("/t/o/[token]", () => {
  it("garbage token: the same GIF, no event", async () => {
    const r = await pixel("garbage");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/gif");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await r.arrayBuffer()).byteLength).toBe(43);
    expect(await events()).toBe(0);
  });

  it("valid token records one estimated open", async () => {
    const r = await pixel(core.signTrack({ m: msgId }, key));
    expect(r.status).toBe(200);
    expect(await db.prisma.event.findMany()).toMatchObject([{ type: "OPEN", isEstimated: true }]);
  });
});

describe("/t/c/[token]", () => {
  const sign = (u: string, k = key) => core.signTrack({ m: msgId, u, i: 0 }, k);

  it("rejects javascript:, relative URLs, a foreign key and an open token; records nothing", async () => {
    const before = await events();
    const other = core.trackingKeys({ ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") })[0]!;
    for (const t of [
      sign("javascript:alert(1)"),
      sign("/relative/path"),
      sign("https://ok.test", other),
      core.signTrack({ m: msgId }, key),
      "nonsense",
    ]) {
      const r = await go(t);
      expect(r.status).toBe(400);
      expect(r.headers.get("location")).toBeNull();
      expect(await r.text()).toBe("This link is invalid.");
    }
    expect(await events()).toBe(before);
  });

  it("valid token: 302 to exactly u, click recorded", async () => {
    const u = "https://example.com/a?x=1&y=2#frag";
    const r = await go(sign(u));
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(u);
    expect(await db.prisma.event.count({ where: { type: "CLICK" } })).toBe(1);
  });
});

describe("/api/tracking-domain/check", () => {
  const ask = (d?: string) =>
    check.GET(new Request(`${ORIGIN}/api/tracking-domain/check${d ? `?domain=${d}` : ""}`), {
      params: Promise.resolve({}),
    });
  it("200 for a verified domain, 404 otherwise", async () => {
    expect((await ask("track.send.test")).status).toBe(200);
    expect((await ask("pending.send.test")).status).toBe(404);
    expect((await ask("evil.test")).status).toBe(404);
    expect((await ask()).status).toBe(404);
  });
});
