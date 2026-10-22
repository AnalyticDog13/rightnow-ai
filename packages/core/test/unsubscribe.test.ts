import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { hashValue } from "../src/leads/suppression";
import { updateWorkspaceSettings } from "../src/settings";
import {
  listUnsubscribeHeaders,
  signUnsubscribe,
  unsubscribeKeys,
  unsubscribeLead,
  unsubscribeUrl,
  verifyUnsubscribe,
  withComplianceFooter,
} from "../src/unsubscribe";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");
const key = unsubscribeKeys({ ENCRYPTION_KEY: K1 })[0]!;
const P = { w: "ws1", l: "lead1", c: "camp1" };
const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));

describe("token", () => {
  test("round trip, tamper, wrong key, old key", () => {
    const t = signUnsubscribe(P, key);
    expect(verifyUnsubscribe(t, [key])).toEqual(P);
    const [body, mac] = t.split(".") as [string, string];
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(verifyUnsubscribe(`${flip(body)}.${mac}`, [key])).toBeNull();
    expect(verifyUnsubscribe(`${body}.${flip(mac)}`, [key])).toBeNull();
    expect(verifyUnsubscribe("garbage", [key])).toBeNull();
    expect(verifyUnsubscribe(`${body}.`, [key])).toBeNull();
    const oldKey = unsubscribeKeys({ ENCRYPTION_KEY: K2 })[0]!;
    const old = signUnsubscribe(P, oldKey);
    expect(verifyUnsubscribe(old, [key])).toBeNull();
    const keys = unsubscribeKeys({ ENCRYPTION_KEY: K1, OLD_ENCRYPTION_KEY: K2 });
    expect(keys).toHaveLength(2);
    expect(verifyUnsubscribe(old, keys)).toEqual(P);
  });
});

describe("headers and footer", () => {
  const https = { appUrl: "https://mail.example.com", unsubscribeKeys: [key] };
  const local = { appUrl: "http://localhost:3000", unsubscribeKeys: [key] };
  test("https mode", () => {
    const t = signUnsubscribe(P, key);
    expect(unsubscribeUrl(https, P, "a@x.test")).toBe(`https://mail.example.com/u/${t}`);
    expect(listUnsubscribeHeaders(https, P, "a@x.test")).toEqual({
      "List-Unsubscribe": `<https://mail.example.com/u/${t}>, <mailto:a@x.test?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
  test("mailto mode has no Post header", () => {
    expect(unsubscribeUrl(local, P, "a@x.test")).toBe("mailto:a@x.test?subject=unsubscribe");
    expect(listUnsubscribeHeaders(local, P, "a@x.test")).toEqual({
      "List-Unsubscribe": "<mailto:a@x.test?subject=unsubscribe>",
    });
  });
  test("footer", () => {
    const p = {
      unsubscribeUrl: "https://h/u/t",
      physicalAddress: "1 Main St",
      hasLinkVariable: false,
    };
    expect(withComplianceFooter({ html: "<p>Hi</p>", text: "Hi" }, p)).toEqual({
      html: '<p>Hi</p><p style="font-size:12px;color:#666">1 Main St<br><a href="https://h/u/t">Unsubscribe</a></p>',
      text: "Hi\n\n--\n1 Main St\nUnsubscribe: https://h/u/t",
    });
  });
  test("blank address throws; bad account email throws", () => {
    const p = { unsubscribeUrl: "https://h/u/t", physicalAddress: "  ", hasLinkVariable: false };
    expect(() => withComplianceFooter({ html: "<p>x</p>", text: "x" }, p)).toThrow(
      "physical_address_required",
    );
    expect(() =>
      withComplianceFooter({ html: null, text: "x" }, { ...p, physicalAddress: "" }),
    ).toThrow();
    for (const bad of ["a@x.test>\r\nBcc: v@x.test", "a b@x.test", "<a@x.test>", "nope", ""]) {
      expect(() => listUnsubscribeHeaders(https, P, bad)).toThrow("invalid_account_email");
      expect(() => listUnsubscribeHeaders(local, P, bad)).toThrow("invalid_account_email");
    }
  });
  test("address always present; link omitted with the variable; html escaped; null html stays null", () => {
    const p = {
      unsubscribeUrl: "https://h/u/t",
      physicalAddress: "<b>X</b> & Co",
      hasLinkVariable: true,
    };
    const r = withComplianceFooter({ html: "<p>Hi</p>", text: "Hi" }, p);
    expect(r.html).toBe(
      '<p>Hi</p><p style="font-size:12px;color:#666">&lt;b&gt;X&lt;/b&gt; &amp; Co</p>',
    );
    expect(r.text).toBe("Hi\n\n--\n<b>X</b> & Co");
    expect(withComplianceFooter({ html: null, text: "Hi" }, p).html).toBeNull();
  });
});

describe("unsubscribeLead", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let ws: string;
  beforeAll(async () => {
    db = await createTestDb();
    ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w" } })).id;
  });
  afterAll(() => db.drop());

  const lead = (email: string, over: Record<string, unknown> = {}) =>
    db.prisma.lead.create({ data: { workspaceId: ws, email, ...over } });
  const enroll = async (leadId: string, n: number) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = await db.prisma.campaign.create({
        data: { workspaceId: ws, name: `c${leadId}${i}` },
      });
      out.push(
        await db.prisma.campaignLead.create({
          data: { workspaceId: ws, campaignId: c.id, leadId, state: i ? "PAUSED" : "ACTIVE" },
        }),
      );
    }
    return out;
  };
  const rows = (email: string) =>
    db.prisma.suppression.findMany({ where: { workspaceId: ws, valueHash: hashValue(email) } });

  test("done then already; one row; all enrollments stopped UNSUBSCRIBED", async () => {
    const l = await lead("a@acme.test");
    await enroll(l.id, 2);
    const p = { w: ws, l: l.id, c: "x" };
    expect(await unsubscribeLead(db.prisma, clock, p, "one_click")).toBe("done");
    expect(await unsubscribeLead(db.prisma, clock, p, "page")).toBe("already");
    const s = await rows("a@acme.test");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ reason: "UNSUBSCRIBE", source: "one_click" });
    // one UNSUBSCRIBE event per lead and campaign, however often the link is used
    expect(await db.prisma.event.findMany({ where: { leadId: l.id } })).toMatchObject([
      { type: "UNSUBSCRIBE", campaignId: "x", dedupeKey: `unsub:${ws}:${l.id}:x` },
    ]);
    const cls = await db.prisma.campaignLead.findMany({ where: { leadId: l.id } });
    expect(cls).toHaveLength(2);
    expect(cls.every((c) => c.state === "STOPPED" && c.stopReason === "UNSUBSCRIBED")).toBe(true);
  });

  test("soft-deleted and merged leads still suppress their own email (I10)", async () => {
    const d = await lead("del@acme.test", { deletedAt: new Date() });
    expect(await unsubscribeLead(db.prisma, clock, { w: ws, l: d.id, c: "x" }, "page")).toBe(
      "done",
    );
    expect(await rows("del@acme.test")).toHaveLength(1);
    const keep = await lead("keep@acme.test");
    const m = await lead("merged@acme.test", { deletedAt: new Date(), mergedIntoId: keep.id });
    expect(await unsubscribeLead(db.prisma, clock, { w: ws, l: m.id, c: "x" }, "page")).toBe(
      "done",
    );
    expect(await rows("merged@acme.test")).toHaveLength(1);
    expect(await rows("keep@acme.test")).toHaveLength(0);
  });

  test("unknown lead or other workspace: 'already', nothing written", async () => {
    const o = await db.prisma.workspace.create({ data: { name: "O", slug: "o" } });
    const l = await lead("c@acme.test");
    expect(await unsubscribeLead(db.prisma, clock, { w: o.id, l: l.id, c: "x" }, "page")).toBe(
      "already",
    );
    expect(await unsubscribeLead(db.prisma, clock, { w: ws, l: "nope", c: "x" }, "page")).toBe(
      "already",
    );
    expect(await rows("c@acme.test")).toHaveLength(0);
  });

});

describe("workspace settings", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let ws: string;
  beforeAll(async () => {
    db = await createTestDb();
    ws = (await db.prisma.workspace.create({ data: { name: "W", slug: "w" } })).id;
  });
  afterAll(() => db.drop());
  test("validates timezone, trims address, audits the new values (the business address is not personal data)", async () => {
    await expect(
      updateWorkspaceSettings(db.prisma, clock, ws, "u", { timezone: "Bad/Zone" }),
    ).rejects.toMatchObject({ status: 400 });
    const r = await updateWorkspaceSettings(db.prisma, clock, ws, "u", {
      timezone: "Europe/Berlin",
      physicalAddress: "  1 Main St  ",
    });
    expect(r).toMatchObject({ timezone: "Europe/Berlin", physicalAddress: "1 Main St" });
    const a = await db.prisma.auditLog.findMany({
      where: { workspaceId: ws, action: "settings.update" },
    });
    expect(a).toHaveLength(1);
    expect(a[0]!.meta).toEqual({ timezone: "Europe/Berlin", physicalAddress: "1 Main St" });
    expect(
      (await updateWorkspaceSettings(db.prisma, clock, ws, "u", { physicalAddress: "" }))
        .physicalAddress,
    ).toBeNull();
  });
});
