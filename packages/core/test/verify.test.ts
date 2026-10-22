import { randomBytes } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { fixedClock } from "../src/clock";
import { decrypt } from "../src/crypto";
import { claimDue } from "../src/dispatch";
import { createImport, runImport } from "../src/leads/import";
import {
  httpVerifier,
  mxVerifier,
  queueVerify,
  runVerify,
  setVerifierSettings,
  workspaceVerifier,
  type EmailVerifier,
} from "../src/leads/verify";
import { planDue } from "../src/planner";
import { unsubscribeKeys } from "../src/unsubscribe";
import { testEnv } from "./accounts-fixture";
import { seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const T = new Date("2026-10-20T10:00:00Z");
const clock = fixedClock(T);
const sig = () => new AbortController().signal;
const err = (code: string) => Object.assign(new Error(code), { code });
const mx = (m: Record<string, string>) => async (d: string) => {
  if (m[d] === "mx") return [{ exchange: "mx.x.test", priority: 1 }];
  throw err(m[d] ?? "ENOTFOUND");
};
const ENV = {
  appUrl: "https://app.example.com",
  unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
};
let n = 0;
const mkWs = async () =>
  (await db.prisma.workspace.create({ data: { name: "W", slug: `w-ver-${++n}` } })).id;
const mkLead = (ws: string, email: string, extra = {}) =>
  db.prisma.lead.create({ data: { workspaceId: ws, email, ...extra } });
const status = (id: string) =>
  db.prisma.lead.findUniqueOrThrow({
    where: { id },
    select: { verificationStatus: true, verifyPrevStatus: true },
  });
/** Verifier answering from a map by address; "throw" throws, "null" leaves unchanged. */
const stub = (m: Record<string, string>): EmailVerifier => ({
  kind: "mx",
  verify: async (e) => {
    const v = m[e];
    if (v === "throw") throw new Error("boom");
    return v && v !== "null" ? (v as never) : null;
  },
});
const claimOpts = {
  limit: 5,
  bootId: "b",
  stalenessSec: 300,
  sendableProviders: ["SMTP" as const],
};

beforeAll(async () => {
  testEnv();
  db = await createTestDb();
});
afterAll(() => db.drop());
// runVerify scans every workspace: leftovers of an earlier test must not count
beforeEach(() =>
  db.prisma.lead.updateMany({
    where: { verificationStatus: "PENDING_JOB" },
    data: { verificationStatus: "NOT_VERIFIED", verifyPrevStatus: null },
  }),
);

describe("mxVerifier", () => {
  const v = mxVerifier(mx({ "ok.test": "mx", "slow.test": "ETIMEOUT", "nodata.test": "ENODATA" }));
  test.each([
    ["a@nomx.test", "INVALID"],
    ["a@nodata.test", "INVALID"],
    ["not-an-email", "INVALID"],
    ["a@mailinator.com", "RISKY"],
    ["a@ok.test", null],
    ["a@slow.test", null],
  ])("%s -> %s", async (email, want) => {
    expect(await v.verify(email, sig())).toBe(want);
  });
});

describe("httpVerifier", () => {
  const cfg = { url: "https://v.example.com/check", apiKey: "k", statusPath: "result.status" };
  const reply = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const pub = async () => ["93.184.216.34"];
  test("maps the status at statusPath and sends a bearer POST", async () => {
    const f = reply({ result: { status: "catch_all" } });
    expect(await httpVerifier(cfg, f, pub).verify("a@b.test", sig())).toBe("CATCH_ALL");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(cfg.url);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.test" });
  });
  test("valid/invalid/risky/unknown map; an unmapped value, HTTP 500 or a huge body is null", async () => {
    for (const [s, want] of [
      ["valid", "VERIFIED"],
      ["invalid", "INVALID"],
      ["risky", "RISKY"],
      ["unknown", "NOT_VERIFIED"],
      ["weird", null],
    ] as const)
      expect(
        await httpVerifier(cfg, reply({ result: { status: s } }), pub).verify("a@b.test", sig()),
      ).toBe(want);
    expect(await httpVerifier(cfg, reply({}, 500), pub).verify("a@b.test", sig())).toBeNull();
    const big = vi.fn(async () => new Response("x".repeat(70_000)));
    expect(await httpVerifier(cfg, big, pub).verify("a@b.test", sig())).toBeNull();
  });
  test("http:// and private hosts are refused before any fetch", async () => {
    const f = reply({ result: { status: "valid" } });
    await expect(
      httpVerifier({ ...cfg, url: "http://v.example.com/x" }, f, pub).verify("a@b.test", sig()),
    ).rejects.toThrow();
    await expect(
      httpVerifier({ ...cfg, url: "https://10.0.0.1/x" }, f).verify("a@b.test", sig()),
    ).rejects.toThrow();
    await expect(
      httpVerifier(cfg, f, async () => ["127.0.0.1"]).verify("a@b.test", sig()),
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("queueVerify / runVerify", () => {
  test("queueVerify sets PENDING_JOB, remembers the status, skips pending and foreign leads", async () => {
    const ws = await mkWs();
    const other = await mkWs();
    const a = await mkLead(ws, "a@q.test", { verificationStatus: "RISKY" });
    const b = await mkLead(ws, "b@q.test");
    const c = await mkLead(other, "c@q.test");
    expect(await queueVerify(db.prisma, clock, ws, "u", [a.id, c.id])).toEqual({ queued: 1 });
    expect(await status(a.id)).toEqual({
      verificationStatus: "PENDING_JOB",
      verifyPrevStatus: "RISKY",
    });
    expect(await queueVerify(db.prisma, clock, ws, "u", [a.id, b.id])).toEqual({ queued: 1 });
    expect((await status(a.id)).verifyPrevStatus).toBe("RISKY");
    expect((await status(c.id)).verificationStatus).toBe("NOT_VERIFIED");
    expect(
      await db.prisma.auditLog.count({ where: { workspaceId: ws, action: "lead.verify" } }),
    ).toBe(2);
  });

  test("runVerify writes results; null and a throw restore the previous status", async () => {
    const ws = await mkWs();
    const L = {
      risky: await mkLead(ws, "risky@r.test", { verificationStatus: "RISKY" }),
      invalid: await mkLead(ws, "invalid@r.test", { verificationStatus: "INVALID" }),
      bad: await mkLead(ws, "bad@r.test"),
      good: await mkLead(ws, "good@r.test"),
    };
    await queueVerify(
      db.prisma,
      clock,
      ws,
      "u",
      Object.values(L).map((l) => l.id),
    );
    const res = await runVerify(db.prisma, clock, {
      verifierFor: async () =>
        stub({
          "risky@r.test": "null",
          "invalid@r.test": "throw",
          "bad@r.test": "INVALID",
          "good@r.test": "VERIFIED",
        }),
    });
    expect(res).toEqual({ done: 4, changed: 2, restored: 2 });
    expect((await status(L.risky.id)).verificationStatus).toBe("RISKY");
    expect((await status(L.invalid.id)).verificationStatus).toBe("INVALID");
    expect(await status(L.bad.id)).toEqual({
      verificationStatus: "INVALID",
      verifyPrevStatus: null,
    });
    expect((await status(L.good.id)).verificationStatus).toBe("VERIFIED");
  });

  test("a lead edited meanwhile keeps its edit; at most 50 per workspace per run", async () => {
    const ws = await mkWs();
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) ids.push((await mkLead(ws, `m${i}@m.test`)).id);
    await queueVerify(db.prisma, clock, ws, "u", ids);
    let edited = "";
    const edit: EmailVerifier = {
      kind: "mx",
      verify: async (email) => {
        // the user marks the first lead they get VERIFIED while the job is verifying it
        if (!edited) {
          edited = email;
          await db.prisma.lead.updateMany({
            where: { email },
            data: { verificationStatus: "VERIFIED" },
          });
        }
        return "INVALID";
      },
    };
    const res = await runVerify(db.prisma, clock, { verifierFor: async () => edit });
    expect(res.done).toBe(50);
    const kept = await db.prisma.lead.findFirstOrThrow({ where: { email: edited } });
    expect(kept.verificationStatus).toBe("VERIFIED");
    expect(
      await db.prisma.lead.count({ where: { workspaceId: ws, verificationStatus: "PENDING_JOB" } }),
    ).toBe(2);
  });

  test("a row PENDING_JOB for 31 minutes is restored without verifying", async () => {
    const ws = await mkWs();
    const l = await mkLead(ws, "stuck@s.test", { verificationStatus: "RISKY" });
    await queueVerify(db.prisma, clock, ws, "u", [l.id]);
    const later = fixedClock(new Date(T.getTime() + 31 * 60_000));
    const verify = vi.fn(async () => "INVALID" as const);
    const res = await runVerify(db.prisma, later, {
      verifierFor: async () => ({ kind: "mx", verify }),
    });
    expect(await status(l.id)).toEqual({ verificationStatus: "RISKY", verifyPrevStatus: null });
    expect(verify).not.toHaveBeenCalled();
    expect(res.restored).toBe(1);
  });

  test("a verifierFor failure restores the whole batch", async () => {
    const ws = await mkWs();
    const l = await mkLead(ws, "cfg@s.test", { verificationStatus: "VERIFIED" });
    await queueVerify(db.prisma, clock, ws, "u", [l.id]);
    await runVerify(db.prisma, clock, {
      verifierFor: async () => {
        throw new Error("bad config");
      },
    });
    expect((await status(l.id)).verificationStatus).toBe("VERIFIED");
  });
});

describe("settings", () => {
  test("setVerifierSettings encrypts the config; workspaceVerifier builds from it", async () => {
    const ws = await mkWs();
    expect((await workspaceVerifier(db.prisma, ws, mx({}))).kind).toBe("mx");
    await setVerifierSettings(db.prisma, clock, ws, "u", {
      kind: "http",
      url: "https://v.example.com/x",
      apiKey: "secret-key",
      statusPath: "a.b",
    });
    const w = await db.prisma.workspace.findUniqueOrThrow({ where: { id: ws } });
    expect(w.verifierKind).toBe("http");
    expect(w.verifierConfigEnc).not.toContain("secret-key");
    expect(JSON.parse(decrypt(w.verifierConfigEnc!))).toEqual({
      url: "https://v.example.com/x",
      apiKey: "secret-key",
      statusPath: "a.b",
    });
    expect((await workspaceVerifier(db.prisma, ws, mx({}))).kind).toBe("http");
    // apiKey omitted on a later save keeps the stored key
    await setVerifierSettings(db.prisma, clock, ws, "u", {
      kind: "http",
      url: "https://v.example.com/y",
      statusPath: "a.b",
    });
    const w2 = await db.prisma.workspace.findUniqueOrThrow({ where: { id: ws } });
    expect(JSON.parse(decrypt(w2.verifierConfigEnc!)).apiKey).toBe("secret-key");
    for (const bad of [
      { kind: "http", url: "http://v.example.com", apiKey: "k", statusPath: "a" },
      { kind: "http", url: "https://v.example.com", apiKey: "k", statusPath: "a b" },
      { kind: "http", url: "https://v.example.com", statusPath: "a", extra: 1 },
    ])
      await expect(setVerifierSettings(db.prisma, clock, ws, "u", bad)).rejects.toThrow();
  });
});

describe("pipeline: import, planner and claim", () => {
  const FILE = Buffer.from("email\r\nv1@v.test\r\nv2@v.test\r\nv3@v.test\r\n");
  const base = {
    fileName: "l.csv",
    data: FILE,
    mapping: ["email"],
    confirmedAuthorized: true,
    lawfulBasis: "legitimate_interest" as const,
  };

  test("verifyOnImport queues exactly the imported leads; an ACTIVE campaign plans nothing until verification ends", async () => {
    const s = await seedCampaign(db.prisma, { at: T, leads: 0, accounts: [{ dailyLimit: 100 }] });
    const { importJobId } = await createImport(db.prisma, s.ws, null, {
      ...base,
      options: { campaignId: s.campaign.id, verifyOnImport: true },
    });
    await runImport(db.prisma, clock, { resolveMx: mx({ "v.test": "mx" }) }, importJobId);
    const leads = await db.prisma.lead.findMany({ where: { workspaceId: s.ws } });
    expect(leads.map((l) => l.verificationStatus)).toEqual([
      "PENDING_JOB",
      "PENDING_JOB",
      "PENDING_JOB",
    ]);
    const plan = () =>
      planDue(db.prisma, clock, { stalenessSec: 300, sendableProviders: ["SMTP"], env: ENV });
    await plan();
    expect(await db.prisma.scheduledMessage.count({ where: { campaignId: s.campaign.id } })).toBe(
      0,
    );
    expect(
      await db.prisma.campaignLead.count({
        where: { campaignId: s.campaign.id, state: "STOPPED" },
      }),
    ).toBe(0);

    await runVerify(db.prisma, clock, {
      verifierFor: async () =>
        stub({ "v1@v.test": "INVALID", "v2@v.test": "VERIFIED", "v3@v.test": "null" }),
    });
    await plan();
    expect(await db.prisma.scheduledMessage.count({ where: { campaignId: s.campaign.id } })).toBe(
      2,
    );
    const inv = await db.prisma.campaignLead.findFirstOrThrow({
      where: { campaignId: s.campaign.id, lead: { email: "v1@v.test" } },
    });
    expect(inv).toMatchObject({ state: "STOPPED", stopReason: "SKIPPED" });
  });

  test("without the flag nothing is queued", async () => {
    const ws = await mkWs();
    const { importJobId } = await createImport(db.prisma, ws, null, { ...base, options: {} });
    await runImport(db.prisma, clock, { resolveMx: mx({ "v.test": "mx" }) }, importJobId);
    expect(
      await db.prisma.lead.count({ where: { workspaceId: ws, verificationStatus: "PENDING_JOB" } }),
    ).toBe(0);
  });

  test("the claim skips a PENDING_JOB lead without cancelling or stopping it", async () => {
    const s = await seedCampaign(db.prisma, { at: T, rows: 1 });
    await queueVerify(db.prisma, clock, s.ws, "u", [s.leads[0]!.lead.id]);
    const mine = async (c: typeof clock) =>
      (await claimDue(db.prisma, c, claimOpts)).filter((x) => x.workspaceId === s.ws);
    expect(await mine(clock)).toEqual([]);
    const r = await db.prisma.scheduledMessage.findUniqueOrThrow({ where: { id: s.rows[0]!.id } });
    expect(r.status).toBe("SCHEDULED");
    expect(r.dueAt.getTime()).toBeGreaterThan(T.getTime());
    expect(
      (await db.prisma.campaignLead.findUniqueOrThrow({ where: { id: s.leads[0]!.cl.id } })).state,
    ).toBe("ACTIVE");
    // verification ends: the row is claimable again
    await db.prisma.lead.update({
      where: { id: s.leads[0]!.lead.id },
      data: { verificationStatus: "VERIFIED" },
    });
    const later = fixedClock(new Date(T.getTime() + 10 * 60_000));
    await db.prisma.emailAccount.updateMany({
      where: { workspaceId: s.ws },
      data: { lastSyncCompletedAt: later.now() },
    });
    expect(await mine(later)).toHaveLength(1);
  });
});
