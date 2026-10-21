import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider } from "@rightnow/providers";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, test } from "vitest";
import { seedCampaign } from "../../../packages/core/test/campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const children: ChildProcess[] = [];
const dir = mkdtempSync(join(tmpdir(), "restart-"));
const key = randomBytes(32).toString("base64");
beforeAll(async () => {
  db = await createTestDb();
  process.env.FAKE_MAIL_DIR = dir; // this process reads the same Fake mailboxes
});
afterAll(async () => {
  for (const c of children) c.kill("SIGKILL");
  await db.drop();
});

const worker = (extra: Record<string, string> = {}) => {
  const c = spawn(process.execPath, ["--import", "tsx", "apps/worker/src/index.ts"], {
    cwd: join(__dirname, "../../.."),
    env: {
      ...process.env,
      MODE: "local",
      DATABASE_URL: db.url,
      ENCRYPTION_KEY: key,
      APP_URL: "https://app.example.com",
      MAIL_PROVIDER_FAKE: "1",
      FAKE_MAIL_DIR: dir,
      SEND_LEASE_SEC: "5", // allowed with the Fake
      WORKER_HEALTH_PORT: "0",
      ...extra,
    },
    stdio: "ignore",
  });
  children.push(c);
  return c;
};

test("E2E #15: a worker killed mid-send is recovered after restart: SENT once, never resent", async () => {
  const P = db.prisma;
  const s = await seedCampaign(P, { at: new Date(), rows: 1, accounts: [{}] });
  const A = s.accounts[0]!;
  const row = () => P.scheduledMessage.findUniqueOrThrow({ where: { id: s.rows[0]!.id } });
  const sentCount = async () => (await getFakeProvider(A.email).sentRaw()).length;

  const first = worker({ FAKE_SEND_HANG_MS: "30000" });
  await expect.poll(sentCount, { timeout: 60_000, interval: 250 }).toBe(1);
  first.kill("SIGKILL");
  await new Promise((r) => first.once("exit", r));
  const r = await row();
  expect(r.status).toBe("SENDING");
  // the killed worker may hold an active send-recovery job; make sure one is orphaned, which blocks the stately
  // queue until its heartbeat times out
  const other = new PgBoss({ connectionString: db.url, max: 2, supervise: false });
  await other.start();
  await other.send("send-recovery", {});
  await other.fetch("send-recovery");
  await other.stop({ graceful: false });
  // the restart's boot recovery must see the 5 s lease expired
  await expect
    .poll(() => Date.now() - r.claimedAt!.getTime() > 6_000, { timeout: 10_000 })
    .toBe(true);

  worker({ FAKE_SEND_HANG_MS: "" });
  await expect
    .poll(async () => (await row()).status, { timeout: 60_000, interval: 500 })
    .toBe("SENT");
  expect(await sentCount()).toBe(1);
  expect(
    (await P.accountDailyUsage.findMany({ where: { accountId: A.id } })).map((u) => [
      u.sent,
      u.reserved,
    ]),
  ).toEqual([[1, 0]]);
}, 180_000);
