import { createTestDb, expectIsolated } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ZodError } from "zod";
import { launchCampaign, type LaunchDeps, resumeCampaign as resume } from "../src/campaigns/launch";
import { PRESETS } from "../src/campaigns/schema";
import {
  archiveCampaign,
  type CampaignError,
  createCampaign,
  deleteCampaign,
  displayCampaignStatus,
  getCampaign,
  listAccountCampaigns,
  listCampaigns,
  pauseCampaign,
  setCampaignAccounts,
  setSchedules,
  updateCampaign,
} from "../src/campaigns/service";
import { fixedClock } from "../src/clock";
import { unsubscribeMode } from "../src/unsubscribe";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let other: string;
const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));
const P = () => db.prisma;
let n = 0;
const camp = async (over: Record<string, unknown> = {}) =>
  (await createCampaign(P(), ws, null, { name: `c${++n}`, ...over })).id;
const account = (w = ws, over: Record<string, unknown> = {}) =>
  P().emailAccount.create({
    data: {
      workspaceId: w,
      provider: "SMTP",
      email: `u${++n}@send.test`,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: "SMTP",
      providerCap: 100,
      ...over,
    },
  });
const audits = (action: string) => P().auditLog.findMany({ where: { workspaceId: ws, action } });
const codes = (e: unknown) =>
  ((e as CampaignError).body as { issues: { code: string }[] }).issues.map((i) => i.code);
const deps = (over: Partial<LaunchDeps> = {}): LaunchDeps => ({
  appUrl: "https://mail.example.com",
  sendable: ["SMTP", "GMAIL", "MICROSOFT"],
  contentIssues: async () => [], // T06 supplies steps and leads
  ...over,
});
/** A launchable campaign: account, schedule, address. */
async function ready(over: Record<string, unknown> = {}) {
  const id = await camp(over);
  const a = await account();
  await setCampaignAccounts(P(), ws, null, id, [a.id]);
  await setSchedules(P(), ws, null, id, { schedules: [{ name: "s", ...PRESETS.officeHours }] });
  return { id, a };
}
const res = (id: string, d = deps()) => resume(P(), clock, d, ws, id, null);
const launch = (id: string, d = deps(), o = {}) => launchCampaign(P(), clock, d, ws, id, null, o);

beforeAll(async () => {
  db = await createTestDb();
  ws = (
    await P().workspace.create({
      data: { name: "w", slug: "w-camp", physicalAddress: "1 Main St" },
    })
  ).id;
  other = (await P().workspace.create({ data: { name: "o", slug: "o-camp" } })).id;
});
afterAll(() => db.drop());

describe("options", () => {
  test("defaults", async () => {
    const c = await createCampaign(P(), ws, null, { name: "d" });
    expect(c).toMatchObject({
      status: "DRAFT",
      minGapSec: 540,
      randomGapSec: 300,
      stopOnReply: true,
      unsubscribeHeader: true,
      prioritizeNewLeads: false,
    });
    expect(await audits("campaign.create")).toHaveLength(1);
  });

  test("validation", async () => {
    const id = await camp();
    await expect(updateCampaign(P(), ws, null, id, { unsubscribeHeader: false })).rejects.toThrow(
      /unsubscribe_header_required/,
    );
    const cc = Array.from({ length: 11 }, (_, i) => `c${i}@x.test`);
    await expect(updateCampaign(P(), ws, null, id, { cc })).rejects.toBeInstanceOf(ZodError);
    await expect(
      updateCampaign(P(), ws, null, id, { cc: cc.slice(0, 6), bcc: cc.slice(6, 11) }),
    ).rejects.toBeInstanceOf(ZodError);
    for (const bad of [
      { minGapSec: 86401 },
      { dailyLimit: 0 },
      { maxNewLeadsPerDay: -1 },
      { nope: 1 },
    ])
      await expect(updateCampaign(P(), ws, null, id, bad)).rejects.toBeInstanceOf(ZodError);
    await expect(
      updateCampaign(P(), ws, null, id, {
        espRoutingRules: Array(21).fill({ action: "send", recipientEsp: "all", senderEsp: "all" }),
      }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(updateCampaign(P(), ws, null, id, { ownerId: "nobody" })).rejects.toMatchObject({
      status: 400,
    });
    const ok = await updateCampaign(P(), ws, null, id, {
      maxNewLeadsPerDay: 0,
      accountTags: ["warm"],
      dailyLimit: null,
    });
    expect(ok).toMatchObject({ maxNewLeadsPerDay: 0, accountTags: ["warm"] });
  });

  test("text-only switches open tracking off", async () => {
    const id = await camp({ trackOpens: true });
    expect(await updateCampaign(P(), ws, null, id, { textOnly: true })).toMatchObject({
      trackOpens: false,
    });
    expect(await updateCampaign(P(), ws, null, id, { trackOpens: true })).toMatchObject({
      trackOpens: false,
    });
  });
});

describe("schedules", () => {
  test("preset stored; bad days, from===to, bad zone rejected; default zone is the workspace's", async () => {
    const id = await camp();
    const [s] = await setSchedules(P(), ws, null, id, {
      schedules: [{ name: "o", ...PRESETS.officeHours }],
    });
    expect(s).toMatchObject({ days: 62, from: "09:00", to: "17:00", timezone: "UTC" });
    const bad = (x: object) =>
      setSchedules(P(), ws, null, id, {
        schedules: [{ name: "x", days: 62, from: "09:00", to: "17:00", ...x }],
      });
    for (const x of [
      { days: 0 },
      { days: 128 },
      { to: "09:00" },
      { timezone: "Mars/Phobos" },
      { from: "24:00" },
    ])
      await expect(bad(x)).rejects.toBeInstanceOf(ZodError);
    await expect(setSchedules(P(), ws, null, id, { schedules: [] })).rejects.toBeInstanceOf(
      ZodError,
    );
    // overnight windows are fine
    await expect(bad({ from: "22:00", to: "06:00" })).resolves.toHaveLength(1);
    expect((await getCampaign(P(), ws, id)).schedules).toHaveLength(1);
  });

  test("start and end dates are local midnights in the first schedule's zone", async () => {
    const id = await camp();
    await setSchedules(P(), ws, null, id, {
      schedules: [{ name: "b", timezone: "Europe/Berlin", ...PRESETS.anyTime }],
      startDate: "2026-11-02",
      endDate: "2026-11-03",
    });
    const c = await getCampaign(P(), ws, id);
    expect(c.startAt?.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(c.endAt?.toISOString()).toBe("2026-11-03T23:00:00.000Z");
    await expect(
      setSchedules(P(), ws, null, id, {
        schedules: [{ name: "b", ...PRESETS.anyTime }],
        startDate: "2026-11-05",
        endDate: "2026-11-01",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("accounts", () => {
  test("a foreign or deleted account is rejected; the set is replaced", async () => {
    const id = await camp();
    const mine = await account();
    const theirs = await account(other);
    const gone = await account(ws, { deletedAt: new Date() });
    for (const bad of [theirs.id, gone.id, "nope"])
      await expect(setCampaignAccounts(P(), ws, null, id, [mine.id, bad])).rejects.toMatchObject({
        status: 400,
      });
    expect((await getCampaign(P(), ws, id)).accounts).toEqual([]);
    await setCampaignAccounts(P(), ws, null, id, [mine.id, mine.id]);
    expect((await getCampaign(P(), ws, id)).accounts).toEqual([{ accountId: mine.id }]);
    await setCampaignAccounts(P(), ws, null, id, []);
    expect((await getCampaign(P(), ws, id)).accounts).toEqual([]);
    await expect(setCampaignAccounts(P(), other, null, id, [theirs.id])).rejects.toMatchObject({
      status: 404,
    });
  });

  test("listAccountCampaigns: both campaigns; foreign account 404; deleted campaigns hidden", async () => {
    const a = await account();
    const [c1, c2, c3] = [await camp(), await camp(), await camp()];
    for (const c of [c1, c2, c3]) await setCampaignAccounts(P(), ws, null, c, [a.id]);
    await deleteCampaign(P(), ws, null, c3);
    expect((await listAccountCampaigns(P(), ws, a.id)).map((c) => c.id).sort()).toEqual(
      [c1, c2].sort(),
    );
    await expect(listAccountCampaigns(P(), other, a.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("launch", () => {
  test("an empty campaign lists every blocker at once", async () => {
    const id = await camp();
    await P().workspace.update({ where: { id: ws }, data: { physicalAddress: " " } });
    const content = async () => [
      { code: "no_leads", level: "block" as const, message: "Add leads" },
      { code: "no_steps", level: "block" as const, message: "Add a first step" },
    ];
    const e = await launch(id, deps({ contentIssues: content })).catch((x) => x);
    expect(e).toMatchObject({ status: 422 });
    expect(codes(e).sort()).toEqual(
      ["no_accounts", "no_leads", "no_physical_address", "no_schedule", "no_steps"].sort(),
    );
    await P().workspace.update({ where: { id: ws }, data: { physicalAddress: "1 Main St" } });
    expect((await getCampaign(P(), ws, id)).status).toBe("DRAFT");
  });

  test("launches, audits, sets launchedAt, is idempotent", async () => {
    const { id } = await ready();
    const r = await launch(id);
    expect(r.status).toBe("ACTIVE");
    const c = await getCampaign(P(), ws, id);
    expect(c.launchedAt).toEqual(clock.now());
    expect(await audits("campaign.launch")).toHaveLength(1);
    expect(await launch(id)).toEqual({ status: "ACTIVE", warnings: [] });
    expect(await audits("campaign.launch")).toHaveLength(1);
  });

  test("a corrupted schedule row and tracking domain block", async () => {
    const { id, a } = await ready({ trackClicks: true });
    await P().emailAccount.update({ where: { id: a.id }, data: { trackingDomain: "t.send.test" } });
    await P().$executeRaw`UPDATE "CampaignSchedule" SET days = 0 WHERE "campaignId" = ${id}`;
    expect(codes(await launch(id).catch((x) => x)).sort()).toEqual([
      "invalid_schedule",
      "tracking_domain_unverified",
    ]);
    await P()
      .$executeRaw`UPDATE "CampaignSchedule" SET timezone = 'Mars/Phobos', days = 62 WHERE "campaignId" = ${id}`;
    expect(codes(await launch(id).catch((x) => x))).toContain("invalid_schedule");
  });

  test("accountTags restricts which assigned accounts count", async () => {
    const { id, a } = await ready({ accountTags: ["warm"] });
    expect(codes(await launch(id).catch((x) => x))).toEqual(["no_accounts"]);
    await P().emailAccount.update({ where: { id: a.id }, data: { tags: ["warm"] } });
    await expect(launch(id)).resolves.toMatchObject({ status: "ACTIVE" });
  });

  test("dns warn blocks unless overridden; the override is audited; block always blocks", async () => {
    const { id } = await ready();
    const warnGate = async (d: string[]) =>
      d.map((domain) => ({ domain, level: "warn" as const, reason: "no DMARC" }));
    expect(codes(await launch(id, deps({ dnsGate: warnGate })).catch((x) => x))).toEqual([
      "dns_warn",
    ]);
    const blockGate = async (d: string[]) =>
      d.map((domain) => ({ domain, level: "block" as const, reason: "no MX" }));
    expect(
      codes(
        await launch(id, deps({ dnsGate: blockGate }), { overrideDnsWarnings: true }).catch(
          (x) => x,
        ),
      ),
    ).toEqual(["dns_block"]);
    await launch(id, deps({ dnsGate: warnGate }), { overrideDnsWarnings: true });
    expect(await audits("campaign.dns_override")).toHaveLength(1);
  });

  test("warnings: low gap, mailto-only, unverified provider, no matching ESP", async () => {
    const { id } = await ready({
      minGapSec: 240,
      espRoutingRules: [{ action: "send", recipientEsp: "all", senderEsp: "google" }],
    });
    const r = await launch(id, deps({ appUrl: "http://localhost:3000", sendable: [] }));
    expect(r.warnings.map((w) => w.code).sort()).toEqual(
      [
        "gap_below_5_min",
        "no_matching_esp",
        "provider_not_verified",
        "unsubscribe_mailto_only",
      ].sort(),
    );
    const clean = await ready();
    expect((await launch(clean.id)).warnings).toEqual([]);
  });

  test("unsubscribeMode", () => {
    const m = unsubscribeMode;
    expect(m("https://mail.example.com")).toBe("https");
    for (const u of [
      "http://mail.example.com",
      "http://localhost:3000",
      "https://localhost",
      "https://a.local",
      "https://x.localhost",
      "https://192.168.1.5",
      "https://10.0.0.1",
      "https://172.20.1.1",
      "https://127.0.0.1",
      "https://169.254.1.1",
      "https://host.docker.internal",
      "https://[::1]",
      "not a url",
    ])
      expect(m(u), u).toBe("mailto");
    expect(m("https://8.8.8.8")).toBe("https");
  });
});

describe("status machine", () => {
  test("pause, resume, archive, delete follow the allowed moves and are audited", async () => {
    const { id } = await ready();
    await expect(pauseCampaign(P(), ws, null, id)).rejects.toMatchObject({ status: 409 }); // DRAFT
    await expect(res(id)).rejects.toMatchObject({ status: 409 });
    await launch(id);
    await expect(deleteCampaign(P(), ws, null, id)).rejects.toMatchObject({
      status: 409,
      message: "campaign_active",
    });
    expect((await pauseCampaign(P(), ws, null, id)).status).toBe("PAUSED");
    await expect(pauseCampaign(P(), ws, null, id)).rejects.toMatchObject({ status: 409 });
    expect((await res(id)).status).toBe("ACTIVE");
    expect((await archiveCampaign(P(), ws, null, id)).status).toBe("ARCHIVED");
    await expect(archiveCampaign(P(), ws, null, id)).rejects.toMatchObject({ status: 409 });
    await expect(res(id)).rejects.toMatchObject({ status: 409 });
    await expect(launch(id)).rejects.toMatchObject({ status: 409 });
    await deleteCampaign(P(), ws, null, id);
    await expect(getCampaign(P(), ws, id)).rejects.toMatchObject({ status: 404 });
    expect((await listCampaigns(P(), ws)).map((c) => c.id)).not.toContain(id);
    const row = await P().campaign.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "ARCHIVED" });
    expect(row.deletedAt).not.toBeNull();
    for (const a of ["pause", "resume", "archive", "delete"])
      expect((await audits(`campaign.${a}`)).filter((x) => x.target === id)).toHaveLength(1);
  });

  test("a patch while ACTIVE is allowed; a paused DRAFT-launched campaign can relaunch", async () => {
    const { id } = await ready();
    await launch(id);
    expect(await updateCampaign(P(), ws, null, id, { dailyLimit: 5 })).toMatchObject({
      dailyLimit: 5,
      status: "ACTIVE",
    });
    await pauseCampaign(P(), ws, null, id);
    await expect(launch(id)).resolves.toMatchObject({ status: "ACTIVE" });
  });

  test("displayCampaignStatus", () => {
    expect(displayCampaignStatus({ status: "COMPLETED" }, true)).toBe("Running Subsequences");
    expect(displayCampaignStatus({ status: "COMPLETED" }, false)).toBe("Completed");
    expect(displayCampaignStatus({ status: "BOUNCE_PROTECT" }, true)).toBe("Bounce Protect");
    expect(displayCampaignStatus({ status: "ACCOUNTS_UNHEALTHY" }, false)).toBe(
      "Accounts Unhealthy",
    );
  });
});

describe("fix round 1", () => {
  test("cc+bcc cap holds across two PATCHes", async () => {
    const id = await camp();
    const m = (k: string, n: number) => Array.from({ length: n }, (_, i) => `${k}${i}@x.test`);
    await updateCampaign(P(), ws, null, id, { cc: m("c", 10) });
    await expect(updateCampaign(P(), ws, null, id, { bcc: m("b", 1) })).rejects.toMatchObject({
      status: 400,
    });
    expect((await getCampaign(P(), ws, id)).bcc).toEqual([]);
    await expect(
      updateCampaign(P(), ws, null, id, { cc: m("c", 9), bcc: m("b", 1) }),
    ).resolves.toBeTruthy();
  });

  test("launch checks use only usable accounts", async () => {
    const gate = async (d: string[]) =>
      d.map((domain) => ({ domain, level: "block" as const, reason: "x" }));
    // paused / needs-attention accounts do not count
    for (const lifecycle of ["PAUSED", "NEEDS_ATTENTION"] as const) {
      const id = await camp();
      const a = await account(ws, { lifecycle });
      await setCampaignAccounts(P(), ws, null, id, [a.id]);
      await setSchedules(P(), ws, null, id, { schedules: [{ name: "s", ...PRESETS.officeHours }] });
      expect(codes(await launch(id).catch((x) => x))).toEqual(["no_accounts"]);
    }
    // a deleted assigned account does not count
    const d = await camp();
    const dead = await account(ws);
    await setCampaignAccounts(P(), ws, null, d, [dead.id]);
    await P().emailAccount.update({ where: { id: dead.id }, data: { deletedAt: new Date() } });
    expect(codes(await launch(d).catch((x) => x))).toContain("no_accounts");
    // an excluded (untagged / paused) account raises no dns_block or tracking block; the usable one does
    const id = await camp({ accountTags: ["warm"], trackClicks: true });
    const good = await account(ws, { tags: ["warm"], email: "good@good.test" });
    const untagged = await account(ws, { email: "bad@bad.test", trackingDomain: "t.bad.test" });
    const paused = await account(ws, {
      tags: ["warm"],
      lifecycle: "PAUSED",
      email: "p@paused.test",
      trackingDomain: "t.p.test",
    });
    await setCampaignAccounts(P(), ws, null, id, [good.id, untagged.id, paused.id]);
    await setSchedules(P(), ws, null, id, { schedules: [{ name: "s", ...PRESETS.officeHours }] });
    const seen: string[][] = [];
    const spy = async (d: string[]) => (seen.push(d), []);
    await launch(id, deps({ dnsGate: spy }));
    expect(seen).toEqual([["good.test"]]);
    // a usable account is checked
    const id2 = await camp();
    const g2 = await account(ws, { email: "z@zed.test" });
    await setCampaignAccounts(P(), ws, null, id2, [g2.id]);
    await setSchedules(P(), ws, null, id2, { schedules: [{ name: "s", ...PRESETS.officeHours }] });
    expect(codes(await launch(id2, deps({ dnsGate: gate })).catch((x) => x))).toEqual([
      "dns_block",
    ]);
  });

  test("no_matching_esp: only send rules count", async () => {
    const dns = { action: "do_not_send", recipientEsp: "all", senderEsp: "all" };
    const a = await ready({ espRoutingRules: [dns] });
    expect((await launch(a.id)).warnings).toEqual([]);
    const b = await ready({
      espRoutingRules: [dns, { action: "send", recipientEsp: "all", senderEsp: "other" }],
    });
    expect((await launch(b.id)).warnings).toEqual([]);
  });

  test("gate I-4: a COMPLETED campaign resumes (re-validated) so leads added after it finished get sent", async () => {
    const { id } = await ready();
    await launch(id);
    await P().campaign.update({ where: { id }, data: { status: "COMPLETED" } });
    await expect(launch(id)).rejects.toMatchObject({ status: 409 });
    await P().workspace.update({ where: { id: ws }, data: { physicalAddress: null } });
    expect(codes(await res(id).catch((x) => x))).toEqual(["no_physical_address"]);
    expect((await getCampaign(P(), ws, id)).status).toBe("COMPLETED");
    await P().workspace.update({ where: { id: ws }, data: { physicalAddress: "1 Main St" } });
    expect((await res(id)).status).toBe("ACTIVE");
  });

  test("relaunch of ACTIVE reports current warnings; resume re-validates", async () => {
    const { id } = await ready();
    await launch(id);
    const r = await launch(id, deps({ sendable: [] }));
    expect(r.warnings.map((w) => w.code)).toEqual(["provider_not_verified"]);
    await pauseCampaign(P(), ws, null, id);
    await P().workspace.update({ where: { id: ws }, data: { physicalAddress: null } });
    expect(codes(await res(id).catch((x) => x))).toEqual(["no_physical_address"]);
    expect((await getCampaign(P(), ws, id)).status).toBe("PAUSED");
    await P().workspace.update({ where: { id: ws }, data: { physicalAddress: "1 Main St" } });
    expect((await res(id)).status).toBe("ACTIVE");
    expect((await audits("campaign.resume")).filter((x) => x.target === id)).toHaveLength(1);
    for (const status of ["ACCOUNTS_UNHEALTHY", "BOUNCE_PROTECT"] as const) {
      await P().campaign.update({ where: { id }, data: { status } });
      expect((await res(id)).status).toBe("ACTIVE");
    }
  });

  test("unsubscribeMode reuses the providers' private-host logic", () => {
    for (const u of [
      "https://[::ffff:7f00:1]",
      "https://[::ffff:127.0.0.1]",
      "https://100.64.0.1",
      "https://localhost./",
      "https://intranet",
      "https://[fd00::1]",
      "https://[::1]",
      "https://0.0.0.0",
      "https://2130706433",
    ])
      expect(unsubscribeMode(u), u).toBe("mailto");
    for (const u of ["https://mail.example.com", "https://8.8.8.8", "https://[2606:4700::1111]"])
      expect(unsubscribeMode(u), u).toBe("https");
  });
});

describe("workspace isolation", () => {
  test("every read and write is scoped", async () => {
    await expectIsolated({
      prisma: P(),
      seed: async (w) => {
        await createCampaign(P(), w, null, { name: "iso" });
      },
      read: (w) => listCampaigns(P(), w),
    });
    const id = await camp();
    const calls = [
      () => getCampaign(P(), other, id),
      () => updateCampaign(P(), other, null, id, { name: "x" }),
      () => setSchedules(P(), other, null, id, { schedules: [{ name: "s", ...PRESETS.anyTime }] }),
      () => setCampaignAccounts(P(), other, null, id, []),
      () => pauseCampaign(P(), other, null, id),
      () => resume(P(), clock, deps(), other, id, null),
      () => archiveCampaign(P(), other, null, id),
      () => deleteCampaign(P(), other, null, id),
      () => launchCampaign(P(), clock, deps(), other, id, null),
    ];
    for (const f of calls) await expect(f()).rejects.toMatchObject({ status: 404 });
    expect((await getCampaign(P(), ws, id)).status).toBe("DRAFT");
  });
});
