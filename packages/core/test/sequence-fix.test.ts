import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  enrollLeads,
  moveToSubsequence,
  removeCampaignLead,
  resumeCampaignLead,
} from "../src/campaigns/enroll";
import { editHooks } from "../src/campaigns/hooks";
import { launchCampaign, type LaunchDeps } from "../src/campaigns/launch";
import { exportCampaign, importCampaign } from "../src/campaigns/portable";
import { PRESETS } from "../src/campaigns/schema";
import {
  addStep,
  addVariant,
  campaignContentIssues,
  createSubsequence,
  deleteStep,
  deleteVariant,
  reorderSteps,
  updateStep,
  updateVariant,
} from "../src/campaigns/sequence";
import {
  type CampaignError,
  createCampaign,
  setCampaignAccounts,
  setSchedules,
} from "../src/campaigns/service";
import { fixedClock } from "../src/clock";
import { addBlocklist } from "../src/leads/blocklist";
import { bulkLeads, createLead, mergeLeads, softDeleteLead } from "../src/leads/service";

let db: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));
const P = () => db.prisma;
let n = 0;
const camp = async (over: Record<string, unknown> = {}) =>
  (await createCampaign(P(), ws, null, { name: `f${++n}`, ...over })).id;
const step = (c: string, delayValue = 1, extra: Record<string, unknown> = {}) =>
  addStep(P(), ws, null, c, { delayValue, ...extra });
const variant = (s: string) =>
  addVariant(P(), ws, null, s, { subject: "Hi {{firstName}}", body: "Hello" });
const lead = async (email = `f${++n}@acme.test`) => (await createLead(P(), ws, null, { email })).id;
const enroll = (c: string, p: Parameters<typeof enrollLeads>[4]) =>
  enrollLeads(P(), clock, ws, c, p);
const fail = async (p: Promise<unknown>) =>
  (await p.then(
    () => null,
    (e: unknown) => e,
  )) as CampaignError;
const cls = (c: string) => P().campaignLead.findMany({ where: { campaignId: c } });
const codes = (x: CampaignError) =>
  (x.body as { issues: { code: string }[] }).issues.map((i) => i.code);
const deps = (): LaunchDeps => ({
  appUrl: "https://mail.example.com",
  sendable: ["SMTP", "GMAIL", "MICROSOFT"],
  contentIssues: (id, w) => campaignContentIssues(P(), id, w),
});
const account = () =>
  P().emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      email: `x${++n}@send.test`,
      fromName: "F",
      firstName: "F",
      lastName: "L",
      capTier: "SMTP",
      providerCap: 100,
    },
  });
const launchable = async (leadIds: string[]) => {
  const c = await camp();
  await setCampaignAccounts(P(), ws, null, c, [(await account()).id]);
  await setSchedules(P(), ws, null, c, { schedules: [{ name: "o", ...PRESETS.officeHours }] });
  await variant((await step(c)).id);
  await enroll(c, { leadIds });
  return c;
};

beforeAll(async () => {
  db = await createTestDb();
  ws = (
    await P().workspace.create({
      data: { name: "w", slug: "w-seqfix", physicalAddress: "1 Main St" },
    })
  ).id;
});
afterAll(() => db.drop());

describe("fix round 1", () => {
  test("live edits: reorder refused once a send exists, delete is soft, no-op patches do not re-plan", async () => {
    const c = await camp();
    const [a, b] = [await step(c), await step(c, 2)];
    const changed = vi.spyOn(editHooks, "stepsChanged");
    await updateStep(P(), ws, null, b.id, { delayValue: 2 }); // unchanged
    await updateStep(P(), ws, null, a.id, { delayValue: 9 }); // step 1 stays 0
    await reorderSteps(P(), ws, null, c, null, [a.id, b.id]); // same order
    expect(changed).not.toHaveBeenCalled();
    await updateStep(P(), ws, null, b.id, { delayValue: 3 });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0]![1]).toMatchObject({ stepId: b.id });
    changed.mockRestore();

    await P().campaign.update({ where: { id: c }, data: { status: "ACTIVE" } });
    await reorderSteps(P(), ws, null, c, null, [b.id, a.id]); // live, but nothing sent yet
    await enroll(c, { leadIds: [await lead()] });
    await P().campaignLead.updateMany({ where: { campaignId: c }, data: { accountId: "acc" } });
    expect(await fail(reorderSteps(P(), ws, null, c, null, [a.id, b.id]))).toMatchObject({
      status: 409,
      message: "campaign_has_sends",
    });
    await P().campaignLead.updateMany({ where: { campaignId: c }, data: { accountId: null } });
    const sends = vi.spyOn(editHooks, "campaignHasSends").mockResolvedValue(true);
    expect(await fail(reorderSteps(P(), ws, null, c, null, [a.id, b.id]))).toMatchObject({
      status: 409,
    });
    sends.mockRestore();
    await deleteStep(P(), ws, null, a.id); // nothing points at it, still soft on a live campaign
    const row = await P().sequenceStep.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  test("merge moves enrollments to the kept lead or stops them; delete and bulk delete stop them", async () => {
    const [a, b] = [await camp(), await camp()];
    const [keep, from] = [await lead(), await lead()];
    await enroll(a, { leadIds: [keep, from] }); // keep is already in a
    await enroll(b, { leadIds: [from] });
    await mergeLeads(P(), clock, ws, { keepId: keep, mergeId: from });
    const inA = await cls(a);
    expect(inA.find((r) => r.leadId === from)).toMatchObject({
      state: "STOPPED",
      stopReason: "SKIPPED",
    });
    expect(inA.find((r) => r.leadId === keep)!.state).toBe("QUEUED");
    expect((await cls(b))[0]).toMatchObject({ leadId: keep, state: "QUEUED" });

    const c = await camp();
    const [x, y, z] = [await lead(), await lead(), await lead()];
    await enroll(c, { leadIds: [x, y, z] });
    await softDeleteLead(P(), clock, ws, x);
    await bulkLeads(P(), clock, ws, { ids: [y], action: "delete" });
    const got = await cls(c);
    const stopped = got.filter((r) => r.state === "STOPPED").map((r) => r.leadId);
    expect(stopped.sort()).toEqual([x, y].sort());
    expect(got.find((r) => r.leadId === z)!.state).toBe("QUEUED");
  });

  test("conflict rule counts system-paused campaigns; launch re-checks it (two DRAFTs race)", async () => {
    const [u, v] = [await camp(), await camp()];
    await P().campaign.update({ where: { id: u }, data: { status: "BOUNCE_PROTECT" } });
    const l0 = await lead();
    await enroll(u, { leadIds: [l0] });
    expect((await enroll(v, { leadIds: [l0] })).skipped.in_other_active_campaign).toBe(1);

    const shared = await lead();
    const [a, b] = [await launchable([shared]), await launchable([shared])];
    const rs = await Promise.allSettled([
      launchCampaign(P(), clock, deps(), ws, a, null),
      launchCampaign(P(), clock, deps(), ws, b, null),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const bad = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(codes(bad.reason)).toEqual(["leads_in_other_active_campaign"]);
    // an explicit allowDuplicates enrollment is exempt
    const loser = rs[0]!.status === "rejected" ? a : b;
    await enroll(loser, { leadIds: [shared], allowDuplicates: true });
    expect((await launchCampaign(P(), clock, deps(), ws, loser, null)).status).toBe("ACTIVE");
  });

  test("entering a subsequence calls the cancel hook with the lead and rolls back when it throws", async () => {
    const c = await camp();
    const sub = await createSubsequence(P(), ws, null, c, {
      name: "s",
      trigger: { kind: "ACTIVITY", activity: "opened" },
    });
    await step(c, 1, { subsequenceId: sub.id });
    const l2 = await lead();
    await enroll(c, { leadIds: [await lead(), l2] });
    const all = await cls(c);
    const [first, second] = [all.find((r) => r.leadId !== l2)!, all.find((r) => r.leadId === l2)!];
    const cancel = vi.spyOn(editHooks, "cancelOpenRows");
    await moveToSubsequence(P(), clock, ws, null, first.id, sub.id);
    expect(cancel).toHaveBeenCalledWith(expect.anything(), [first.id]);

    cancel.mockRejectedValue(new Error("boom"));
    await expect(moveToSubsequence(P(), clock, ws, null, second.id, sub.id)).rejects.toThrow(
      "boom",
    );
    await expect(removeCampaignLead(P(), clock, ws, null, second.id)).rejects.toThrow("boom");
    expect(await P().campaignLead.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      state: "QUEUED",
      subsequenceId: null,
      stopReason: null,
    });
    cancel.mockRestore();
  });

  test("variant, step and suppression hooks run inside their transactions", async () => {
    const c = await camp();
    const s = await step(c);
    const v = await variant(s.id);
    await variant(s.id);
    const changed = vi.spyOn(editHooks, "variantChanged");
    const removed = vi.spyOn(editHooks, "stepRemoved");
    await updateVariant(P(), ws, null, v.id, { weight: 5 }); // weight alone: no hook
    expect(changed).not.toHaveBeenCalled();
    await updateVariant(P(), ws, null, v.id, { body: "new" });
    expect(changed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variantId: v.id, removed: false }),
    );
    changed.mockRejectedValue(new Error("boom"));
    await expect(deleteVariant(P(), ws, null, v.id)).rejects.toThrow("boom");
    expect(await P().stepVariant.count({ where: { id: v.id } })).toBe(1);
    await deleteStep(P(), ws, null, s.id);
    expect(removed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stepId: s.id }),
    );
    changed.mockRestore();
    removed.mockRestore();

    await enroll(c, { leadIds: [await lead("hook@hooked.test")] });
    const cancel = vi.spyOn(editHooks, "cancelOpenRows");
    await addBlocklist(P(), ws, null, ["hooked.test"]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect((await cls(c))[0]).toMatchObject({ state: "STOPPED", stopReason: "SUPPRESSED" });
    cancel.mockRestore();
  });

  test("resume clears a stale stopReason; a stopped lead cannot move; oversized imports are refused", async () => {
    const c = await camp();
    await enroll(c, { leadIds: [await lead()] });
    const [cl] = await cls(c);
    await P().campaignLead.update({
      where: { id: cl!.id },
      data: { state: "PAUSED", stopReason: "SEND_FAILED" },
    });
    expect(await resumeCampaignLead(P(), ws, null, cl!.id)).toMatchObject({
      state: "QUEUED",
      stopReason: null,
    });
    await removeCampaignLead(P(), clock, ws, null, cl!.id);
    const sub = await createSubsequence(P(), ws, null, c, {
      name: "s",
      trigger: { kind: "ACTIVITY", activity: "opened" },
    });
    await step(c, 1, { subsequenceId: sub.id });
    expect(await fail(moveToSubsequence(P(), clock, ws, null, cl!.id, sub.id))).toMatchObject({
      status: 409,
    });
    const doc = await exportCampaign(P(), ws, c);
    const variants = [
      { label: "A", subject: "s", body: "x".repeat(6_000_000), weight: 1, active: true },
    ];
    const big = { ...doc, steps: [{ order: 1, delayValue: 0, delayUnit: "DAYS", variants }] };
    expect(await fail(importCampaign(P(), ws, null, big))).toMatchObject({ status: 413 });
  });
});
