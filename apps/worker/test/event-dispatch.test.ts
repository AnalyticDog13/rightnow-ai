import { createRule, fixedClock } from "@rightnow/core";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { jobs } from "../src/jobs";
import { eventDispatch, eventDispatchJob } from "../src/jobs/event-dispatch";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const reply = (ws: string, k: string) =>
  db.prisma.event.create({
    data: { workspaceId: ws, type: "REPLY", occurredAt: T, dedupeKey: `ed:${k}` },
  });

test("event-dispatch: every minute, at boot, stately, with a heartbeat (R2)", () => {
  expect(eventDispatchJob).toMatchObject({
    name: "event-dispatch",
    cron: "* * * * *",
    boot: true,
    options: { policy: "stately", retryLimit: 0, heartbeatSeconds: 10 },
  });
  expect(jobs).toContain(eventDispatchJob);
});

test("the handler with a fixed clock dispatches pending events and exits within maxMs", async () => {
  const P = db.prisma;
  const ws = (await P.workspace.create({ data: { name: "W", slug: "w-ed-1" } })).id;
  await createRule(P, ws, null, {
    name: "r",
    trigger: "reply_received",
    actions: [{ type: "create_task", title: "Follow up" }],
  });
  const es = [await reply(ws, "1"), await reply(ws, "2")];
  const t0 = Date.now();
  expect(await eventDispatch(P, fixedClock(T), { maxMs: 500 })).toEqual({
    events: 2,
    runs: 2,
    deliveries: 0,
  });
  expect(Date.now() - t0).toBeLessThan(3_000);
  for (const e of es)
    expect((await P.event.findUniqueOrThrow({ where: { id: e.id } })).dispatchedAt).toEqual(T);
  expect((await P.task.findMany({ where: { workspaceId: ws } })).map((t) => t.title)).toEqual([
    "Follow up",
    "Follow up",
  ]);
});
