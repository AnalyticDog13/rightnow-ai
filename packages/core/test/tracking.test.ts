import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "@rightnow/db/test-db";
import type { AccountProvider } from "@rightnow/db/client";
import { getFakeProvider } from "@rightnow/providers";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fixedClock } from "../src/clock";
import { claimDue, type ClaimOpts } from "../src/dispatch";
import {
  recordClick,
  recordOpen,
  signTrack,
  trackingBase,
  trackingKeys,
  verifyTrack,
  withTracking,
} from "../src/mail/tracking";
import { sendClaimed, type SenderDeps } from "../src/sender";
import { unsubscribeKeys, unsubscribeUrl } from "../src/unsubscribe";
import { seedCampaign } from "./campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "tracking-"));

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");
const key = trackingKeys({ ENCRYPTION_KEY: K1 })[0]!;

describe("tokens", () => {
  test("round trip, tamper, old key, wrong purpose", () => {
    const t = signTrack({ m: "m1", u: "https://a.test/x?a=1&b=2", i: 3 }, key);
    expect(verifyTrack(t, [key])).toEqual({ m: "m1", u: "https://a.test/x?a=1&b=2", i: 3 });
    expect(verifyTrack(signTrack({ m: "m1" }, key), [key])).toEqual({ m: "m1" });
    expect(verifyTrack((t[0] === "A" ? "B" : "A") + t.slice(1), [key])).toBeNull();
    expect(verifyTrack("garbage", [key])).toBeNull();
    const old = trackingKeys({ ENCRYPTION_KEY: K2 })[0]!;
    const oldTok = signTrack({ m: "m2" }, old);
    expect(verifyTrack(oldTok, [key])).toBeNull();
    expect(
      verifyTrack(oldTok, trackingKeys({ ENCRYPTION_KEY: K1, OLD_ENCRYPTION_KEY: K2 })),
    ).toEqual({ m: "m2" });
    // an unsubscribe token is not a tracking token
    const unsub = unsubscribeKeys({ ENCRYPTION_KEY: K1 })[0]!;
    expect(verifyTrack(signTrack({ m: "x" }, unsub), [key])).toBeNull();
  });
});

describe("withTracking / trackingBase", () => {
  const o = { base: "https://t.test", scheduledMessageId: "m1", opens: true, clicks: true, key };
  test("rewrites links, keeps unsubscribe and mailto, adds the pixel before </body>", () => {
    const unsub = "https://app.test/u/abc";
    const html = `<html><body><a href="https://a.test/1?x=1&amp;y=2">a</a> <a href='http://b.test'>b</a> <a href="${unsub}">u</a> <a href="mailto:x@y.test">m</a></body></html>`;
    const out = withTracking(html, { ...o, skipUrls: [unsub] });
    const toks = [...out.matchAll(/https:\/\/t\.test\/t\/c\/([\w.-]+)/g)].map((m) =>
      verifyTrack(m[1]!, [key]),
    );
    expect(toks).toEqual([
      { m: "m1", u: "https://a.test/1?x=1&y=2", i: 0 },
      { m: "m1", u: "http://b.test", i: 1 },
    ]);
    expect(out).toContain(`href="${unsub}"`);
    expect(out).toContain('href="mailto:x@y.test"');
    expect(out).toMatch(
      /<img src="https:\/\/t\.test\/t\/o\/[\w.-]+" width="1" height="1" alt="" style="display:none"><\/body>/,
    );
  });
  test("a /u/ link on the base stays untracked even if signed by another key", () => {
    const html = '<a href="https://t.test/u/signed-by-an-older-key">u</a>';
    expect(withTracking(html, { ...o, opens: false, skipUrls: [] })).toBe(html);
    // tracking domain differs from the app URL that carries the footer link
    const app = '<a href="https://app.test/u/old-key-token">u</a>';
    expect(withTracking(app, { ...o, opens: false, skipUrls: ["https://app.test/u/new"] })).toBe(
      app,
    );
  });
  test("malformed hrefs are left as written and do not throw", () => {
    const bad = '<a href="http://">a</a><a href="https://exa mple.com">b</a>';
    const out = withTracking(`${bad}<a href="https://ok.test/x">c</a>`, {
      ...o,
      opens: false,
      skipUrls: [],
    });
    expect(out.startsWith(bad)).toBe(true);
    expect(out).toContain("https://t.test/t/c/");
  });
  test("opens off / no body tag", () => {
    expect(withTracking("<p>x</p>", { ...o, opens: false, skipUrls: [] })).toBe("<p>x</p>");
    expect(withTracking("<p>x</p>", { ...o, clicks: false, skipUrls: [] })).toMatch(
      /<p>x<\/p><img /,
    );
  });
  test("trackingBase", () => {
    const a = { trackingDomain: "track.x.test", trackingDomainStatus: "VERIFIED" as const };
    expect(trackingBase(a, "http://localhost:3000")).toBe("https://track.x.test");
    expect(trackingBase({ ...a, trackingDomainStatus: "FAILED" }, "https://app.test/")).toBe(
      "https://app.test",
    );
    const none = { trackingDomain: null, trackingDomainStatus: "UNVERIFIED" as const };
    expect(trackingBase(none, "http://localhost:3000")).toBeNull();
  });
});

describe("db", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  const P = () => db.prisma;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await db.drop();
  });

  const T = new Date("2026-10-20T10:00:00Z");
  const ALL: AccountProvider[] = ["GMAIL", "MICROSOFT", "SMTP"];
  const env = {
    appUrl: "https://app.example.com",
    unsubscribeKeys: unsubscribeKeys({ ENCRYPTION_KEY: K1 }),
    trackingKeys: [key],
  };
  const deps: SenderDeps = { providerFor: (a) => getFakeProvider(a.email), env, random: () => 0 };
  const claimOpts: ClaimOpts = {
    limit: 1,
    bootId: "b",
    stalenessSec: 300,
    sendableProviders: ALL,
    env,
  };
  const body = '<p>Hi <a href="https://x.test/p">link</a></p>';

  /** Seeds one row with `renderedBody`, sends it, returns the stored row and the html the Fake received. */
  async function sendOne(o: Omit<Parameters<typeof seedCampaign>[1], "at" | "rows" | "accounts">) {
    const s = await seedCampaign(P(), { at: T, rows: 1, accounts: [{}], ...o });
    // the claim re-renders the row from its variant
    await P().stepVariant.update({ where: { id: s.steps[0]!.variant.id }, data: { body } });
    const clock = fixedClock(T);
    const [c] = await claimDue(P(), clock, claimOpts);
    expect(await sendClaimed(P(), clock, deps, c!)).toBe("SENT");
    const m = await getFakeProvider(s.accounts[0]!.email).findSent(c!.rfcMessageId);
    const stored = await P().scheduledMessage.findUniqueOrThrow({ where: { id: c!.id } });
    return { s, html: m?.html ?? "", stored };
  }

  test("sender tracks the sent copy; the stored body stays untracked", async () => {
    const { html, stored } = await sendOne({ campaign: { trackOpens: true, trackClicks: true } });
    expect(html).toContain("/t/o/");
    expect(html).toContain("/t/c/");
    expect(stored.renderedBody).toContain("https://x.test/p");
    expect(stored.renderedBody).not.toContain("/t/");
  });

  test.each([
    ["textOnly", { trackOpens: true, trackClicks: true, textOnly: true }, {}],
    ["firstEmailTextOnly step 1", { trackOpens: true, firstEmailTextOnly: true }, {}],
    ["disableOpenTracking", { trackOpens: true }, { disableOpenTracking: true }],
    ["trackOpens off", { trackOpens: false }, {}],
  ])("no pixel: %s", async (_n, campaign, workspace) => {
    const { html } = await sendOne({ campaign, workspace });
    expect(html).not.toContain("/t/o/");
    if ("textOnly" in campaign) expect(html).not.toContain("/t/c/");
  });

  test("the unsubscribe link in the sent body is not rewritten", async () => {
    const s = await seedCampaign(P(), {
      at: T,
      rows: 1,
      accounts: [{}],
      campaign: { trackClicks: true },
    });
    const u = unsubscribeUrl(
      env,
      { w: s.ws, l: s.leads[0]!.lead.id, c: s.campaign.id },
      s.accounts[0]!.email,
    );
    await P().stepVariant.update({
      where: { id: s.steps[0]!.variant.id },
      data: { body: `<p><a href="${u}">Unsubscribe</a></p>` },
    });
    const clock = fixedClock(T);
    const [c] = await claimDue(P(), clock, claimOpts);
    await sendClaimed(P(), clock, deps, c!);
    const m = await getFakeProvider(s.accounts[0]!.email).findSent(c!.rfcMessageId);
    expect(m!.html).toContain(u);
    expect(m!.html).not.toContain("/t/c/");
  });

  async function sentRow() {
    const s = await seedCampaign(P(), {
      at: T,
      rows: 1,
      accounts: [{}],
      campaign: { trackOpens: true, trackClicks: true },
    });
    await P().scheduledMessage.update({
      where: { id: s.rows[0]!.id },
      data: { status: "SENT", sentAt: T },
    });
    return { s, m: s.rows[0]!, leadId: s.leads[0]!.lead.id };
  }
  const lead = (id: string) => P().lead.findUniqueOrThrow({ where: { id } });
  const at = (ms: number) => fixedClock(new Date(T.getTime() + ms));

  test("recordOpen: twice in one minute is one event; counts the open", async () => {
    const { m, leadId } = await sentRow();
    await recordOpen(P(), at(3600_000), { m: m.id }, "Mozilla/5.0");
    await recordOpen(P(), at(3600_000), { m: m.id }, "Mozilla/5.0");
    const ev = await P().event.findMany({ where: { type: "OPEN" } });
    expect(ev).toMatchObject([{ isEstimated: true, leadId, meta: { machine: false } }]);
    expect(await lead(leadId)).toMatchObject({ opens: 1 });
    expect((await lead(leadId)).lastOpenAt).toEqual(at(3600_000).now());
  });

  test("recordOpen: 5 s after send, or a proxy UA, is machine and not counted", async () => {
    const { m, leadId } = await sentRow();
    await recordOpen(P(), at(5000), { m: m.id }, "Mozilla/5.0");
    await recordOpen(P(), at(7200_000), { m: m.id }, "GoogleImageProxy");
    const ev = await P().event.findMany({ where: { type: "OPEN" } });
    expect(ev.map((e) => e.meta)).toEqual([{ machine: true }, { machine: true }]);
    expect(await lead(leadId)).toMatchObject({ opens: 0, lastOpenAt: null });
  });

  test("recordClick counts, a scanner does not; an unknown message records nothing", async () => {
    const { m, leadId } = await sentRow();
    await recordClick(P(), at(3600_000), { m: m.id, u: "https://x.test", i: 0 }, "Mozilla/5.0");
    await recordClick(P(), at(3600_000), { m: m.id, u: "https://x.test", i: 1 }, "Proofpoint");
    await recordClick(P(), at(3600_000), { m: "nope", u: "https://x.test", i: 0 }, null);
    expect(await P().event.count({ where: { type: "CLICK" } })).toBe(2);
    expect(await lead(leadId)).toMatchObject({ clicks: 1 });
  });

  test.each(["opened", "clicked"] as const)(
    "I10: %s enters the ACTIVITY subsequence",
    async (activity) => {
      const { s, m } = await sentRow();
      const sub = await P().subsequence.create({
        data: {
          campaignId: s.campaign.id,
          name: "s",
          trigger: { kind: "ACTIVITY", activity },
          activatedAt: new Date(0),
        },
      });
      const step = await P().sequenceStep.create({
        data: { campaignId: s.campaign.id, subsequenceId: sub.id, order: 1, delayValue: 0 },
      });
      await P().stepVariant.create({
        data: { stepId: step.id, label: "A", subject: "s", body: "b" },
      });
      if (activity === "opened") await recordOpen(P(), at(3600_000), { m: m.id }, "Mozilla/5.0");
      else
        await recordClick(P(), at(3600_000), { m: m.id, u: "https://x.test", i: 0 }, "Mozilla/5.0");
      const cl = await P().campaignLead.findUniqueOrThrow({ where: { id: s.leads[0]!.cl.id } });
      expect(cl).toMatchObject({ subsequenceId: sub.id, currentStepId: step.id });
    },
  );

  test("a user-PAUSED enrolment never enters a subsequence; a soft-deleted lead's counters stay", async () => {
    const { s, m, leadId } = await sentRow();
    const sub = await P().subsequence.create({
      data: {
        campaignId: s.campaign.id,
        name: "s",
        trigger: { kind: "ACTIVITY", activity: "opened" },
        activatedAt: new Date(0),
      },
    });
    await P().sequenceStep.create({
      data: { campaignId: s.campaign.id, subsequenceId: sub.id, order: 1, delayValue: 0 },
    });
    await P().campaignLead.update({
      where: { id: s.leads[0]!.cl.id },
      data: { state: "PAUSED", stopReason: "MANUAL" },
    });
    await P().lead.update({ where: { id: leadId }, data: { deletedAt: T } });
    await recordOpen(P(), at(3600_000), { m: m.id }, "Mozilla/5.0");
    const cl = await P().campaignLead.findUniqueOrThrow({ where: { id: s.leads[0]!.cl.id } });
    expect(cl).toMatchObject({ state: "PAUSED", subsequenceId: null });
    expect(await lead(leadId)).toMatchObject({ opens: 0, lastOpenAt: null });
  });
});
