import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock, resetEnvCache } from "@rightnow/core";
import type { EmailAccount } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import {
  getFakeProvider,
  type MailProvider,
  type OutboundMime,
  type SendResult,
} from "@rightnow/providers";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, test } from "vitest";
import { seedCampaign } from "../../../packages/core/test/campaign-fixture";
import { startWorker } from "../src/boss";
import { campaignDispatch, campaignDispatchJob } from "../src/jobs/campaign-dispatch";
import { eventDispatchJob } from "../src/jobs/event-dispatch";
import { sendRecoveryJob } from "../src/jobs/send-recovery";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local", // vitest sets MODE=test
    DATABASE_URL: db.url,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    APP_URL: "https://app.example.com",
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "crash-")),
    SEND_LEASE_SEC: "600",
  });
  resetEnvCache();
});
afterAll(async () => {
  resetEnvCache();
  await db.drop();
});

const T = new Date("2026-10-20T10:00:00Z");

/** A live worker whose dispatch uses `send`, plus send-recovery (not at boot: the test triggers it after the lease). */
async function run(send: (a: EmailAccount, m: OutboundMime) => Promise<SendResult>) {
  const P = db.prisma;
  const clock = fixedClock(T);
  const s = await seedCampaign(P, { at: T, rows: 1, accounts: [{}] });
  const A = s.accounts[0]!;
  const providerFor = (a: EmailAccount): MailProvider =>
    Object.assign(Object.create(getFakeProvider(a.email)) as MailProvider, {
      send: (m: OutboundMime) => send(a, m),
    });
  const w = await startWorker({
    databaseUrl: db.url,
    healthPort: 0,
    clock,
    jobs: [
      {
        ...campaignDispatchJob,
        handler: async (_j, d) => {
          await campaignDispatch(d.prisma, d.clock, d.bootId, undefined, providerFor);
        },
      },
      { ...sendRecoveryJob, boot: false },
    ],
  });
  const row = () => P.scheduledMessage.findUniqueOrThrow({ where: { id: s.rows[0]!.id } });
  return { P, clock, A, w, row };
}

test("handler crash after the provider accepted → UNCERTAIN → found after the lease → SENT, sent once", async () => {
  let crashed = false;
  const { P, clock, A, w, row } = await run(async (a, m) => {
    const r = await getFakeProvider(a.email).send(m);
    if (crashed) return r;
    crashed = true;
    throw new Error("db gone"); // not a ProviderError: the outcome is unknown
  });
  try {
    await expect.poll(async () => (await row()).status, { timeout: 20_000 }).toBe("UNCERTAIN");
    clock.advance(601_000);
    await w.boss.send("send-recovery", {});
    await expect.poll(async () => (await row()).status, { timeout: 20_000 }).toBe("SENT");
    expect(await getFakeProvider(A.email).sentRaw()).toHaveLength(1);
    expect(
      (await P.accountDailyUsage.findMany({ where: { accountId: A.id } })).map((u) => [
        u.sent,
        u.reserved,
      ]),
    ).toEqual([[1, 0]]);
  } finally {
    await w.stop();
  }
}, 60_000);

test("post-send update never happens (row left SENDING) → UNCERTAIN after the lease → SENT, sent once", async () => {
  let resume!: () => void;
  const late = new Promise<void>((r) => (resume = r));
  const { P, clock, A, w, row } = await run(async (a, m) => {
    const r = await getFakeProvider(a.email).send(m);
    await late; // the handler is alive but its result transaction does not run
    return r;
  });
  try {
    await expect
      .poll(
        () =>
          getFakeProvider(A.email)
            .sentRaw()
            .then((x) => x.length),
        {
          timeout: 20_000,
        },
      )
      .toBe(1);
    expect((await row()).status).toBe("SENDING");
    clock.advance(601_000);
    await w.boss.send("send-recovery", {});
    await expect.poll(async () => (await row()).status, { timeout: 20_000 }).toBe("SENT");
    expect(await getFakeProvider(A.email).sentRaw()).toHaveLength(1);
  } finally {
    resume(); // the original result now arrives as a repeat: nothing changes
    await w.stop();
  }
  expect((await row()).status).toBe("SENT");
  expect(
    (await P.accountDailyUsage.findMany({ where: { accountId: A.id } })).map((u) => [
      u.sent,
      u.reserved,
    ]),
  ).toEqual([[1, 0]]);
}, 60_000);

test("R2: a killed event-dispatch run is followed by a new run within 60 s", async () => {
  const P = db.prisma;
  const ws = (await P.workspace.create({ data: { name: "W", slug: "w-crash-ed" } })).id;
  // a worker that died holding an active event-dispatch job: fetched, never completed, no heartbeat
  const dead = new PgBoss({ connectionString: db.url, max: 2, supervise: false });
  await dead.start();
  await dead.createQueue(eventDispatchJob.name, eventDispatchJob.options);
  await dead.send(eventDispatchJob.name, {});
  expect(await dead.fetch(eventDispatchJob.name)).toHaveLength(1);
  await dead.stop({ graceful: false });
  const e = await P.event.create({
    data: { workspaceId: ws, type: "REPLY", occurredAt: T, dedupeKey: "crash:ed" },
  });
  const w = await startWorker({
    databaseUrl: db.url,
    healthPort: 0,
    clock: fixedClock(T),
    jobs: [eventDispatchJob], // its boot send waits behind the orphan (stately) until the heartbeat fails it
  });
  try {
    await expect
      .poll(async () => (await P.event.findUniqueOrThrow({ where: { id: e.id } })).dispatchedAt, {
        timeout: 60_000,
        interval: 500,
      })
      .toEqual(T);
  } finally {
    await w.stop();
  }
}, 90_000);
