import { randomBytes } from "node:crypto";
import type { EventType, Prisma } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { deliverabilityOverview } from "../src/deliverability/overview";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(T.getTime() - d * DAY);
const hex = () => randomBytes(4).toString("hex");

const mkWs = (inactivityDays = 30) =>
  P().workspace.create({ data: { name: "W", slug: `w-${hex()}`, inactivityDays } });
const mkAcct = (
  ws: string,
  email: string,
  o: Partial<Prisma.EmailAccountUncheckedCreateInput> = {},
) =>
  P().emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "MICROSOFT",
      capTier: "MS365",
      providerCap: 5000,
      email,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      createdAt: ago(90),
      ...o,
    },
  });
const events = (
  ws: string,
  accountId: string,
  type: EventType,
  n: number,
  o: { at?: Date; reasons?: string[]; untargeted?: boolean } = {},
) =>
  P().event.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      workspaceId: ws,
      accountId,
      type,
      occurredAt: o.at ?? ago(5 + i * 0.01),
      meta: o.reasons ? { reason: o.reasons[i] } : {},
      scheduledMessageId: o.untargeted ? null : `sm-${hex()}`,
      dedupeKey: `t:${hex()}${hex()}`,
    })),
  });

describe("deliverabilityOverview", () => {
  test("one row per account kind, exact values and warnings", async () => {
    const ws = (await mkWs()).id;
    const a = await mkAcct(ws, "active@a.test", {
      lastSentAt: ago(2),
      healthCap: 15,
      healthScore: 82,
      errorCount24h: 2,
    });
    const b = await mkAcct(ws, "inactive@b.test", { lifecycle: "INACTIVE", lastSentAt: ago(45) });
    const c = await mkAcct(ws, "rewarm@c.test", {
      lifecycle: "REWARMING",
      lastSentAt: ago(1),
      rewarmStartedAt: ago(4),
      rewarmStartVolume: 5,
      rewarmIncrementPerDay: 2,
      rewarmTarget: 30,
      rewarmSendDays: 3,
      rewarmLastSendDay: new Date("2026-10-19T00:00:00Z"),
    });
    const d = await mkAcct(ws, "paused@d.test", {
      lifecycle: "PAUSED",
      lastSentAt: ago(3),
      lastError: { kind: "SOFT_BOUNCE", code: "bounce_rate" },
    });
    const e = await mkAcct(ws, "attention@e.test", {
      lifecycle: "NEEDS_ATTENTION",
      lastSentAt: ago(3),
    });
    // account A: 30-day activity
    await events(ws, a.id, "ACCEPTED", 100);
    await events(ws, a.id, "BOUNCE_HARD", 3, { at: ago(1), reasons: ["h1", "h2", "h3"] });
    await events(ws, a.id, "BOUNCE_SOFT", 4, { at: ago(10), reasons: ["s1", "s2", "s3", "s4"] });
    await events(ws, a.id, "BOUNCE_HARD", 5, { untargeted: true }); // matched no send of ours: never counts
    await events(ws, a.id, "REPLY", 10);
    await events(ws, a.id, "COMPLAINT", 1);
    await events(ws, a.id, "ACCEPTED", 5, { at: ago(40) }); // outside 30 days
    await P().healthSnapshot.createMany({
      data: [
        { accountId: a.id, day: new Date("2026-10-18"), score: 80 },
        { accountId: a.id, day: new Date("2026-10-19"), score: 81 },
        { accountId: a.id, day: new Date("2026-10-20"), score: 82 },
        { accountId: a.id, day: new Date("2026-09-01"), score: 10 },
      ],
    });
    const ok = { status: "pass", reason: "ok" };
    await P().domainCheck.create({
      data: {
        workspaceId: ws,
        domain: "a.test",
        checkedAt: T,
        level: "warn",
        selectors: [],
        report: {
          domain: "a.test",
          checkedAt: T.toISOString(),
          managed: false,
          spf: ok,
          dkim: ok,
          dmarc: { status: "warn", reason: "No DMARC record", policy: null },
          mx: ok,
          dnsbl: ok,
          ptr: null,
        },
      },
    });
    await P().warmupSettings.create({
      data: { accountId: a.id, workspaceId: ws, enabled: true, filterTag: "t" },
    });
    await P().warmupMessage.create({
      data: {
        workspaceId: ws,
        fromAccountId: a.id,
        toAccountId: c.id,
        kind: "SEND",
        status: "SENT",
        rfcMessageId: `<${hex()}@t>`,
        subject: "s",
        dueAt: ago(1),
        sentAt: ago(1),
        landedFolder: "INBOX",
      },
    });
    // another workspace: never visible
    const other = await mkWs();
    const x = await mkAcct(other.id, "x@x.test", { lastSentAt: ago(1) });
    await events(other.id, x.id, "ACCEPTED", 7);

    const rows = await deliverabilityOverview(P(), ws, T);
    expect(rows.map((r) => r.email).sort()).toEqual([
      "active@a.test",
      "attention@e.test",
      "inactive@b.test",
      "paused@d.test",
      "rewarm@c.test",
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.email.split("@")[0]!, r]));

    expect(by.active).toMatchObject({
      id: a.id,
      status: "Active",
      idleDays: 2,
      allowance: 15,
      target: 30,
      plan: null,
      health: {
        score: 82,
        cap: 15,
        trend: [
          { day: "2026-10-18", score: 80 },
          { day: "2026-10-19", score: 81 },
          { day: "2026-10-20", score: 82 },
        ],
      },
      sent30d: 100,
      hardBouncePct30d: 3,
      softBouncePct30d: 4,
      replyPct30d: 10,
      complaintPct30d: 1,
      lastBounceReasons: ["h1", "h2", "h3"],
      recentErrors: 2,
      dns: { level: "warn", domain: "a.test" },
      warmup: { state: "PLACEMENT_UNKNOWN" },
      warnings: [
        "Health throttled to 15/day",
        "DNS: No DMARC record",
        "Warm-up has no peers",
        "Hard bounces 3% in 30 days",
      ],
    });
    expect(by.active!.warmup!.last7).toHaveLength(7);
    expect(by.active!.warmup!.last7.at(-2)).toMatchObject({ day: "2026-10-19", sent: 1, inbox: 1 });

    expect(by.inactive).toMatchObject({
      status: "Inactive",
      idleDays: 45,
      warnings: ["Idle for 45 days"],
      health: { score: null, cap: null, trend: [] },
      dns: null,
      warmup: null,
      sent30d: 0,
      hardBouncePct30d: 0,
      lastBounceReasons: [],
    });
    expect(by.rewarm).toMatchObject({
      status: "Re-Warming",
      allowance: 11,
      target: 30,
      warnings: [],
      plan: {
        allowance: 11,
        target: 30,
        progressPct: 37,
        estimatedDaysLeft: 10,
        label: "configurable plan, not a guaranteed reputation recovery timeline",
      },
    });
    expect(by.paused).toMatchObject({ status: "Paused", plan: null, warnings: [] });
    expect(by.attention).toMatchObject({ status: "Needs Attention", warnings: [] });
    expect(e.id).toBe(by.attention!.id);
    expect(b.id).toBe(by.inactive!.id);
    expect(d.id).toBe(by.paused!.id);
  });

  test("a DNS block outranks a warning in the warning text", async () => {
    const ws = (await mkWs()).id;
    await mkAcct(ws, "m@blk.test", { lastSentAt: ago(1) });
    const ok = { status: "pass", reason: "ok" };
    await P().domainCheck.create({
      data: {
        workspaceId: ws,
        domain: "blk.test",
        checkedAt: T,
        level: "block",
        selectors: [],
        report: {
          domain: "blk.test",
          checkedAt: T.toISOString(),
          managed: false,
          spf: { status: "fail", reason: "No SPF record", record: null, lookups: 0 },
          dkim: { status: "warn", reason: "No DKIM key", selectors: [] },
          dmarc: ok,
          mx: ok,
          dnsbl: ok,
          ptr: null,
        },
      },
    });
    const [r] = await deliverabilityOverview(P(), ws, T);
    expect(r!.dns).toEqual({ level: "block", domain: "blk.test" });
    expect(r!.warnings).toEqual(["DNS: No SPF record"]);
  });

  test("at most 10 queries for 20 accounts", async () => {
    const ws = (await mkWs()).id;
    for (let i = 0; i < 20; i++) {
      const a = await mkAcct(ws, `q${i}@q${i}.test`, { lastSentAt: ago(1) });
      await events(ws, a.id, "ACCEPTED", 2);
      await P().warmupSettings.create({
        data: { accountId: a.id, workspaceId: ws, enabled: true, filterTag: "t" },
      });
    }
    let n = 0;
    const counted = P().$extends({
      query: {
        $allOperations({ args, query }) {
          n++;
          return query(args);
        },
      },
    });
    const rows = await deliverabilityOverview(counted as never, ws, T);
    expect(rows).toHaveLength(20);
    expect(n).toBeLessThanOrEqual(10);
  });
});
