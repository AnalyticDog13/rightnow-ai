import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createWebhook, fixedClock, resetEnvCache } from "@rightnow/core";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { jobs } from "../src/jobs";
import { retentionJob } from "../src/jobs/retention";
import { webhookDeliver, webhookDeliverJob } from "../src/jobs/webhook-deliver";

let db: Awaited<ReturnType<typeof createTestDb>>;
let server: http.Server;
let port = 0;
const got: string[] = [];
beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local", // vitest sets MODE=test
    DATABASE_URL: db.url,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    APP_URL: "https://app.example.com",
  });
  resetEnvCache();
  server = http.createServer((req, res) => {
    got.push(String(req.headers["x-rightnow-event-id"]));
    req.resume();
    req.on("end", () => res.end());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  resetEnvCache();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.drop();
});

const T = new Date("2026-10-20T10:00:00Z");

test("webhook-deliver: every minute, at boot, stately, with a heartbeat (R2); retention daily", () => {
  expect(webhookDeliverJob).toMatchObject({
    name: "webhook-deliver",
    cron: "* * * * *",
    boot: true,
    options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  });
  expect(retentionJob).toMatchObject({
    name: "retention",
    cron: "23 3 * * *",
    options: { policy: "stately", retryLimit: 0 },
  });
  expect(jobs).toEqual(expect.arrayContaining([webhookDeliverJob, retentionJob]));
});

test("the handler POSTs a due delivery and exits within maxMs; private hosts need the flag", async () => {
  const P = db.prisma;
  const ws = (await P.workspace.create({ data: { name: "W", slug: "w-wd-1" } })).id;
  const resolve = async () => ["127.0.0.1"];
  const w = await createWebhook(
    P,
    ws,
    null,
    { url: `http://hook.test:${port}/`, events: ["email_sent"] },
    { allowPrivate: true, resolve },
  );
  const d = await P.webhookDelivery.create({
    data: {
      workspaceId: ws,
      webhookId: w.id,
      eventId: "ev1",
      eventType: "email_sent",
      payload: {},
      nextAttemptAt: T,
    },
  });
  delete process.env.ALLOW_PRIVATE_HTTP_HOSTS;
  resetEnvCache();
  expect(await webhookDeliver(P, fixedClock(T), { maxMs: 0, resolve })).toEqual({
    delivered: 0,
    failed: 1,
  });
  expect(got).toEqual([]);
  process.env.ALLOW_PRIVATE_HTTP_HOSTS = "1";
  resetEnvCache();
  const t0 = Date.now();
  const later = fixedClock(new Date(T.getTime() + 60_000));
  expect(await webhookDeliver(P, later, { maxMs: 300, resolve })).toEqual({
    delivered: 1,
    failed: 0,
  });
  expect(Date.now() - t0).toBeLessThan(3_000);
  expect(got).toEqual(["ev1"]);
  expect((await P.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe(
    "DELIVERED",
  );
  delete process.env.ALLOW_PRIVATE_HTTP_HOSTS;
  resetEnvCache();
});
