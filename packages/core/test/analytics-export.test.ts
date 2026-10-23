import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { exportActivityCsv, metricsCsv } from "../src/analytics/export";
import { analytics } from "../src/analytics/metrics";
import { analyticsQuery } from "../src/analytics/query";
import { AT, analyticsFixture, day2 } from "./analytics-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

const q = (o: Record<string, unknown> = {}) => analyticsQuery.parse(day2(o));
async function chunks(it: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const c of it) out.push(c);
  return out;
}
const lines = (cs: string[]) => cs.join("").split("\r\n").filter(Boolean);

test("activity CSV: one row per counted Event, flags, links, injection", async () => {
  const f = await analyticsFixture(P());
  await P().lead.update({ where: { id: f.L4.id }, data: { email: "=cmd@x.io" } });
  const rows = lines(await chunks(exportActivityCsv(P(), f.ws, q())));
  expect(rows[0]).toBe("date,action,lead_email,account,campaign,step,variant,link,flags");
  // 26 fixture events: minus the 11-01 and 11-03 ones, minus the untargeted DSN and ARF
  expect(rows).toHaveLength(1 + 22);
  expect(rows.some((r) => r.includes("forged"))).toBe(false);
  const machine = rows.filter((r) => r.split(",")[1] === "OPEN");
  expect(machine.map((r) => r.split(",").at(-1)).sort()).toEqual(["", "", "machine"]);
  const click = rows.find((r) => r.split(",")[1] === "CLICK" && r.endsWith(",")) ?? "";
  expect(click.split(",")[7]).toBe("https://acme.test/p");
  expect(rows.find((r) => r.includes("scanner"))!.split(",")[1]).toBe("CLICK");
  const reply = rows.find((r) => r.split(",")[1] === "REPLY" && r.includes(f.L1.email))!;
  expect(reply.split(",").slice(3, 7)).toEqual([f.X.email, "Campaign C", "2", "A"]);
  expect(rows.filter((r) => r.includes("'=cmd@x.io"))).toHaveLength(3); // L4: ACCEPTED, AUTO_REPLY, soft bounce; not its untargeted DSN and ARF
  expect(rows.some((r) => r.split(",")[2] === "=cmd@x.io")).toBe(false);
  expect(rows[1]!.startsWith("2026-11-02T09:00:00.000Z,")).toBe(true); // oldest first
});

test("activity CSV pages by (occurredAt, id), 500 at a time, with no duplicates", async () => {
  const f = await analyticsFixture(P());
  const base = { ...f.sends.s1aL1, workspaceId: f.ws, type: "CLICK" as const };
  await P().event.createMany({
    data: Array.from({ length: 1200 }, (_, i) => ({
      ...base,
      // pairs share a timestamp, so the id breaks the tie
      occurredAt: new Date(AT("2026-11-05T00:00:00Z").getTime() + Math.floor(i / 2) * 1000),
      meta: { scanner: false, url: `https://acme.test/${i}` },
      dedupeKey: `p:${f.ws}:${i}`,
    })),
  });
  const cs = await chunks(
    exportActivityCsv(P(), f.ws, q({ from: "2026-11-05", to: "2026-11-05" })),
  );
  expect(cs).toHaveLength(1 + 3); // header + three pages
  const rows = lines(cs).slice(1);
  expect(rows).toHaveLength(1200);
  expect(new Set(rows.map((r) => r.split(",")[7])).size).toBe(1200);
});

test("metricsCsv: header, one row per group, then the total; cells escaped", async () => {
  const f = await analyticsFixture(P());
  await P().campaign.update({ where: { id: f.C2.id }, data: { name: "=HYPERLINK(1)" } });
  const r = await analytics(P(), f.ws, q({ groupBy: "campaign" }));
  const out = metricsCsv(r).split("\r\n").filter(Boolean);
  expect(out[0]!.startsWith("key,label,sent,contacted,")).toBe(true);
  expect(out).toHaveLength(1 + r.rows.length + 1);
  expect(out.find((l) => l.startsWith(`${f.C2.id},`))).toContain(",'=HYPERLINK(1),");
  expect(out.at(-1)!.startsWith("total,Total,6,")).toBe(true);
  expect(out[0]).toContain("rate_reply");
});
