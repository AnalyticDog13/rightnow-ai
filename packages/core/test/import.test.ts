import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { fixedClock } from "../src/clock";
import { csvCell, exportLeadsCsv } from "../src/leads/export";
import { createImport, previewImport, runImport } from "../src/leads/import";
import { createLead } from "../src/leads/service";
import { suppress } from "../src/leads/suppression";

let db: Awaited<ReturnType<typeof createTestDb>>;
const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));
const noMx = async () => {
  throw Object.assign(new Error("x"), { code: "ESERVFAIL" });
};
let n = 0;
const mkWs = async () => {
  const ws = (await db.prisma.workspace.create({ data: { name: "W", slug: `w-imp-${++n}` } })).id;
  await createLead(db.prisma, ws, null, { email: "existing@x.test", firstName: "Orig" });
  await db.prisma.$transaction((tx) =>
    suppress(
      tx,
      ws,
      [
        { kind: "EMAIL", value: "blocked@x.test" },
        { kind: "DOMAIN", value: "spam.test" },
      ],
      "MANUAL",
      "t",
    ),
  );
  return ws;
};
const FILE = Buffer.from(
  "﻿Email;First Name\r\n" +
    [
      "a@x.test;A",
      "ALICE@x.test;Big",
      "alice@x.test;Small",
      "b@;B",
      ";NoMail",
      "existing@x.test;Changed",
      "blocked@x.test;Bl",
      "c@spam.test;C",
      "d@mailinator.com;D",
      "e@y.test;E",
    ].join("\r\n") +
    "\r\n",
);
const base = {
  fileName: "leads.csv",
  data: FILE,
  mapping: ["email", "firstName"],
  options: {},
  confirmedAuthorized: true,
  lawfulBasis: "legitimate_interest" as const,
};
const job = (id: string) => db.prisma.importJob.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.drop());

describe("import (Review Focus #4)", () => {
  test("exact counts and skip reasons; data cleared; stored fields", async () => {
    const ws = await mkWs();
    const { importJobId } = await createImport(db.prisma, ws, null, base);
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    const j = await job(importJobId);
    expect(j).toMatchObject({
      status: "DONE",
      total: 10,
      imported: 3,
      attached: 0,
      progress: 100,
      data: null,
    });
    expect(j.skipped).toEqual({
      duplicate_in_file: 1,
      invalid_email: 1,
      missing_email: 1,
      exists_in_workspace: 1,
      blocklisted: 2,
      disposable: 1,
    });
    const leads = await db.prisma.lead.findMany({
      where: { workspaceId: ws, importJobId },
      orderBy: { email: "asc" },
    });
    expect(leads.map((l) => l.email)).toEqual(["a@x.test", "alice@x.test", "e@y.test"]);
    expect(leads[1]).toMatchObject({
      firstName: "Big",
      source: "csv:leads.csv",
      lawfulBasis: "legitimate_interest",
    });
    expect(leads[0]!.espType).toBe("NOT_FOUND"); // lookup failed, but never left IN_QUEUE
    expect(
      await db.prisma.lead.count({
        where: { workspaceId: ws, email: { in: ["blocked@x.test", "c@spam.test"] } },
      }),
    ).toBe(0);
    const ex = await db.prisma.lead.findFirstOrThrow({
      where: { workspaceId: ws, email: "existing@x.test" },
    });
    expect(ex.firstName).toBe("Orig");
    expect(
      await db.prisma.auditLog.count({ where: { workspaceId: ws, action: "lead.import" } }),
    ).toBe(1);
  });

  test("skipIfInWorkspace false attaches an existing lead to the list without touching it", async () => {
    const ws = await mkWs();
    const list = await db.prisma.leadList.create({ data: { workspaceId: ws, name: "L" } });
    const { importJobId } = await createImport(db.prisma, ws, null, {
      ...base,
      options: { skipIfInWorkspace: false, listId: list.id },
    });
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    const j = await job(importJobId);
    expect(j).toMatchObject({ imported: 3, attached: 1 });
    expect(j.skipped).not.toHaveProperty("exists_in_workspace");
    const members = await db.prisma.leadListMember.findMany({
      where: { listId: list.id },
      include: { lead: true },
    });
    expect(members.map((m) => m.lead.email).sort()).toEqual([
      "a@x.test",
      "alice@x.test",
      "e@y.test",
      "existing@x.test",
    ]);
    expect(members.find((m) => m.lead.email === "existing@x.test")!.lead.firstName).toBe("Orig");
  });

  test("second run imports nothing; a crashed run resumes with exact counts", async () => {
    const ws = await mkWs();
    const { importJobId } = await createImport(db.prisma, ws, null, base);
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    expect(await db.prisma.lead.count({ where: { workspaceId: ws, importJobId } })).toBe(3);

    // a worker that died after inserting: job back to PENDING, leads already there
    await db.prisma.importJob.update({
      where: { id: importJobId },
      data: { status: "PENDING", data: new Uint8Array(FILE) },
    });
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    expect(await job(importJobId)).toMatchObject({ status: "DONE", imported: 3 });
  });

  test("campaign targets: validated, imported leads are enrolled, skipIfInCampaign skips members", async () => {
    const ws = await mkWs();
    await expect(
      createImport(db.prisma, ws, null, { ...base, options: { campaignId: "nope" } }),
    ).rejects.toMatchObject({ status: 400, message: "unknown_campaign" });
    await expect(
      createImport(db.prisma, ws, null, { ...base, options: { skipIfInCampaign: true } }),
    ).rejects.toMatchObject({ status: 400, message: "campaign_required" });
    const camp = await db.prisma.campaign.create({ data: { workspaceId: ws, name: "C" } });
    const ex = await db.prisma.lead.findFirstOrThrow({
      where: { workspaceId: ws, email: "existing@x.test" },
    });
    await db.prisma.campaignLead.create({
      data: { workspaceId: ws, campaignId: camp.id, leadId: ex.id },
    });
    const options = { campaignId: camp.id, skipIfInCampaign: true, skipIfInWorkspace: false };
    const { importJobId } = await createImport(db.prisma, ws, null, { ...base, options });
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    const done = await job(importJobId);
    expect(done).toMatchObject({ status: "DONE", imported: 3 });
    expect(done.skipped).toMatchObject({ exists_in_campaign: 1 });
    const rows = await db.prisma.campaignLead.findMany({
      where: { campaignId: camp.id },
      include: { lead: true },
    });
    expect(rows.map((c) => c.lead.email).sort()).toEqual([
      "a@x.test",
      "alice@x.test",
      "e@y.test",
      "existing@x.test",
    ]);
  });

  test("list dedupe: skipIfInList skips members, otherwise they count as attached; resume keeps the counts", async () => {
    const ws = await mkWs();
    const list = await db.prisma.leadList.create({ data: { workspaceId: ws, name: "L" } });
    const ex = await db.prisma.lead.findFirstOrThrow({
      where: { workspaceId: ws, email: "existing@x.test" },
    });
    await db.prisma.leadListMember.create({ data: { listId: list.id, leadId: ex.id } });
    const run = async (skipIfInList: boolean) => {
      const { importJobId } = await createImport(db.prisma, ws, null, {
        ...base,
        options: { skipIfInWorkspace: false, listId: list.id, skipIfInList },
      });
      await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
      return importJobId;
    };
    const skip = await job(await run(true));
    expect(skip).toMatchObject({ imported: 3, attached: 0 });
    expect(skip.skipped).toMatchObject({ exists_in_list: 1, duplicate_in_file: 1, blocklisted: 2 });
    expect(skip.skipped).not.toHaveProperty("exists_in_workspace");

    const ws2 = await mkWs();
    const l2 = await db.prisma.leadList.create({ data: { workspaceId: ws2, name: "L" } });
    const ex2 = await db.prisma.lead.findFirstOrThrow({
      where: { workspaceId: ws2, email: "existing@x.test" },
    });
    await db.prisma.leadListMember.create({ data: { listId: l2.id, leadId: ex2.id } });
    const mk2 = (skipIfInList: boolean) =>
      createImport(db.prisma, ws2, null, {
        ...base,
        options: { skipIfInWorkspace: false, listId: l2.id, skipIfInList },
      });
    const { importJobId: off } = await mk2(false);
    await runImport(db.prisma, clock, { resolveMx: noMx }, off);
    expect(await job(off)).toMatchObject({ imported: 3, attached: 1 });
    expect((await job(off)).skipped).not.toHaveProperty("exists_in_list");

    // crash after attaching: the lead attached by this job is attached again on resume, not exists_in_list
    const ws3 = await mkWs();
    const l3 = await db.prisma.leadList.create({ data: { workspaceId: ws3, name: "L" } });
    const { importJobId } = await createImport(db.prisma, ws3, null, {
      ...base,
      options: { skipIfInWorkspace: false, listId: l3.id, skipIfInList: true },
    });
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    const first = await job(importJobId);
    expect(first).toMatchObject({ imported: 3, attached: 1 });
    await db.prisma.importJob.update({
      where: { id: importJobId },
      data: { status: "PENDING", data: new Uint8Array(FILE) },
    });
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    const again = await job(importJobId);
    expect(again).toMatchObject({
      status: "DONE",
      imported: 3,
      attached: 1,
      skipped: first.skipped,
    });
    expect(again.skipped).not.toHaveProperty("exists_in_list");
  });

  test("an unterminated quote is a clear error, not a silently truncated import", async () => {
    const ws = await mkWs();
    const data = Buffer.from('email,firstName\na@x.test,A\nb@x.test,"oops\nc@x.test,C\n');
    await expect(
      createImport(db.prisma, ws, null, { ...base, data, mapping: ["email", "firstName"] }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("csv_parse_error") });
    await expect(previewImport(db.prisma, ws, data)).rejects.toMatchObject({ status: 400 });
  });

  test("a deadlocked batch is retried; a non-retryable error still fails the job", async () => {
    const ws = await mkWs();
    const { importJobId } = await createImport(db.prisma, ws, null, base);
    const real = db.prisma.$transaction.bind(db.prisma);
    let fails = 2;
    const spy = vi.spyOn(db.prisma, "$transaction").mockImplementation(((...a: unknown[]) => {
      if (fails-- > 0)
        return Promise.reject(Object.assign(new Error("deadlock"), { code: "P2034" }));
      return (real as (...x: unknown[]) => unknown)(...a);
    }) as never);
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    spy.mockRestore();
    expect(await job(importJobId)).toMatchObject({ status: "DONE", imported: 3 });

    const { importJobId: bad } = await createImport(db.prisma, ws, null, base);
    const spy2 = vi.spyOn(db.prisma, "$transaction").mockRejectedValue(new Error("boom"));
    await runImport(db.prisma, clock, { resolveMx: noMx }, bad);
    spy2.mockRestore();
    expect(await job(bad)).toMatchObject({ status: "FAILED", error: "boom", data: null });
  });

  test("export keeps plain numbers, neutralizes formulas behind spaces or quotes", () => {
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell("-1.5e3")).toBe("-1.5e3");
    expect(csvCell(" =cmd")).toBe("' =cmd");
    expect(csvCell('"=cmd')).toBe('"\'""=cmd"');
    expect(csvCell("-hello")).toBe("'-hello");
    expect(csvCell("\rx")).toBe('"\'\rx"');
    expect(csvCell("plain")).toBe("plain");
  });

  test("validation: authorization 400, size and row limits 413, bad list and mapping 400", async () => {
    const ws = await mkWs();
    await expect(
      createImport(db.prisma, ws, null, { ...base, confirmedAuthorized: false }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createImport(db.prisma, ws, null, { ...base, data: Buffer.alloc(50 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ status: 413 });
    const many = Buffer.from("email\n" + "a@x.test\n".repeat(100_001));
    await expect(
      createImport(db.prisma, ws, null, { ...base, mapping: ["email"], data: many }),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      createImport(db.prisma, ws, null, { ...base, options: { listId: "nope" } }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createImport(db.prisma, ws, null, { ...base, mapping: ["firstName", "lastName"] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("workspace isolation: one workspace's job never writes into or reads from another", async () => {
    const a = await mkWs();
    const b = await db.prisma.workspace.create({ data: { name: "B", slug: "w-imp-iso-b" } });
    const { importJobId } = await createImport(db.prisma, a, null, base);
    await runImport(db.prisma, clock, { resolveMx: noMx }, importJobId);
    expect(await db.prisma.lead.count({ where: { workspaceId: b.id } })).toBe(0);
    // A's blocklist and leads do not apply to B
    const jb = await createImport(db.prisma, b.id, null, base);
    await runImport(db.prisma, clock, { resolveMx: noMx }, jb.importJobId);
    const got = await db.prisma.lead.findMany({
      where: { workspaceId: b.id },
      select: { email: true },
    });
    expect(got.map((l) => l.email)).toContain("blocked@x.test");
    expect(got.map((l) => l.email)).toContain("existing@x.test");
  });

  test("ESP detection: one lookup per domain, INVALID on ENOTFOUND, timeout leaves verification alone", async () => {
    const ws = await mkWs();
    const rows = ["email"];
    for (let i = 0; i < 10; i++) rows.push(`g${i}@acme-g.test`, `n${i}@acme-n.test`);
    rows.push("t@acme-t.test");
    const calls: string[] = [];
    const resolveMx = async (d: string) => {
      calls.push(d);
      if (d === "acme-g.test") return [{ exchange: "aspmx.l.google.com", priority: 1 }];
      if (d === "acme-n.test") throw Object.assign(new Error("x"), { code: "ENOTFOUND" });
      return new Promise<never>(() => {});
    };
    const { importJobId } = await createImport(db.prisma, ws, null, {
      ...base,
      data: Buffer.from(rows.join("\n")),
      mapping: ["email"],
    });
    await runImport(db.prisma, clock, { resolveMx, mxTimeoutMs: 20 }, importJobId);
    expect(calls.sort()).toEqual(["acme-g.test", "acme-n.test", "acme-t.test"]);
    const by = (d: string) =>
      db.prisma.lead.findFirstOrThrow({ where: { workspaceId: ws, email: { endsWith: `@${d}` } } });
    expect(await by("acme-g.test")).toMatchObject({
      espType: "GOOGLE",
      verificationStatus: "NOT_VERIFIED",
    });
    expect(await by("acme-n.test")).toMatchObject({
      espType: "NOT_FOUND",
      verificationStatus: "INVALID",
    });
    expect(await by("acme-t.test")).toMatchObject({
      espType: "NOT_FOUND",
      verificationStatus: "NOT_VERIFIED",
    });
  });

  test("the MX phase reports progress as it goes", async () => {
    const ws = await mkWs();
    const rows = ["email", ...Array.from({ length: 40 }, (_, i) => `u@d${i}.test`)];
    const seen: number[] = [];
    const { importJobId } = await createImport(db.prisma, ws, null, {
      ...base,
      data: Buffer.from(rows.join("\n")),
      mapping: ["email"],
    });
    const resolveMx = async () => {
      seen.push((await job(importJobId)).progress);
      return [{ exchange: "mx.other.test", priority: 1 }];
    };
    await runImport(db.prisma, clock, { resolveMx }, importJobId);
    expect(seen.every((p) => p >= 90)).toBe(true);
    expect(Math.max(...seen)).toBeGreaterThan(90);
  });
});

describe("previewImport", () => {
  test("samples the first 1000 rows, counts the whole file's lines", async () => {
    const ws = await mkWs();
    const lines = ["email,name"];
    for (let i = 0; i < 5000; i++) lines.push(`u${i}@x.test,${i}`);
    lines[3] = "existing@x.test,e";
    lines[8] = "bad,8";
    lines[9] = "u1@x.test,dup";
    const p = await previewImport(db.prisma, ws, Buffer.from(lines.join("\n") + "\n"));
    expect(p).toMatchObject({ sampled: true, totalRows: 5000, mapping: ["email", "custom:name"] });
    expect(p.sample).toHaveLength(5);
    expect(p.counts).toEqual({
      rows: 1000,
      missingEmail: 0,
      invalidEmail: 1,
      duplicateInFile: 1,
      existsInWorkspace: 1,
    });
    const small = await previewImport(db.prisma, ws, Buffer.from("email\na@x.test\n"));
    expect(small).toMatchObject({ sampled: false, totalRows: 1 });
  });
});

describe("exportLeadsCsv", () => {
  const dump = async (ws: string) => {
    let out = "";
    for await (const c of exportLeadsCsv(db.prisma, ws, {})) out += c;
    return out;
  };

  test("neutralizes formula injection, unions custom columns, quotes cells", async () => {
    const ws = await mkWs();
    await createLead(db.prisma, ws, null, {
      email: "f@x.test",
      firstName: "=HYPERLINK(1)",
      lastName: "a,b",
      customFields: { size: 9 },
    });
    await createLead(db.prisma, ws, null, {
      email: "g@x.test",
      companyName: "@c",
      customFields: { color: "+red" },
    });
    // createLead trims, but the column itself can hold a leading tab
    await db.prisma.lead.updateMany({
      where: { workspaceId: ws, email: "g@x.test" },
      data: { firstName: "	x" },
    });
    const out = await dump(ws);
    const head = out.split("\r\n")[0]!.split(",");
    expect(head.slice(-2)).toEqual(["color", "size"]);
    expect(out).toContain("'=HYPERLINK(1)");
    expect(out).toContain('"a,b"');
    expect(out).toContain("'\tx");
    expect(out).toContain("'@c");
    expect(out).toContain("'+red");
    expect(out).not.toMatch(/(^|,)[=+@]/m);
  });

  test("other workspaces' leads are never exported", async () => {
    const ws = await mkWs();
    const other = await mkWs();
    await createLead(db.prisma, other, null, { email: "secret@x.test" });
    const out = await dump(ws);
    expect(out).not.toContain("secret@x.test");
    expect(out).toContain("existing@x.test");
  });
});
