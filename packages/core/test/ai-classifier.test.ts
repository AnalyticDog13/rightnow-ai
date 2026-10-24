import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailAccount } from "@rightnow/db/client";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider, HttpOutError, type SafeResponse } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { aiClassifierFor } from "../src/ai/classifier";
import { setAiSettings } from "../src/ai/settings";
import { setAiFeedback } from "../src/ai/suggestions";
import { fixedClock } from "../src/clock";
import { reconcileAccount, type SyncDeps } from "../src/mail/sync";
import { testEnv } from "./accounts-fixture";
import { seedCampaign } from "./campaign-fixture";

process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "ai-cls-"));

let db: Awaited<ReturnType<typeof createTestDb>>;
const P = () => db.prisma;
beforeAll(async () => {
  testEnv();
  db = await createTestDb();
});
afterAll(() => db.drop());

const T = new Date("2026-10-20T10:00:00Z");
const DAY = 86_400_000;
const fake = (a: { email: string }) => getFakeProvider(a.email);
const OUT = { allowPrivate: false, resolve: async () => ["93.184.216.34"] };
const ok = (content: string): SafeResponse => ({
  status: 200,
  headers: {},
  latencyMs: 1,
  body: Buffer.from(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }),
  ),
});

let n = 0;
async function setup(o: { classifierEnabled?: boolean; historical?: boolean } = {}) {
  const s = await seedCampaign(P(), {
    at: T,
    leads: 1,
    accounts: [{ credentialsEnc: "x", lastSyncCompletedAt: null, email: `aic${++n}@send.test` }],
  });
  await P().campaignLead.updateMany({
    where: { campaignId: s.campaign.id },
    data: { enrolledAt: new Date(T.getTime() - DAY) },
  });
  await setAiSettings(
    P(),
    s.ws,
    null,
    {
      baseUrl: "https://llm.example.com/v1",
      apiKey: "k",
      model: "m",
      classifierEnabled: o.classifierEnabled ?? true,
    },
    OUT,
  );
  const A = s.accounts[0]! as EmailAccount;
  // the first sync of a mailbox is a HISTORICAL import (no AI); settle it so the replies below arrive incrementally
  if (!o.historical)
    await reconcileAccount(P(), fixedClock(T), A.id, {
      providerFor: async (a) => fake(a),
      env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 },
    });
  return { ...s, A };
}
type Chat = { messages: { content: string }[] };
/** Sync deps whose AI classifier talks to `answer` instead of a provider. */
const depsWith = (
  clock: ReturnType<typeof fixedClock>,
  answer: (body: Chat) => string | Promise<string>,
  calls: { n: number } = { n: 0 },
  extra: Partial<SyncDeps> = {},
): SyncDeps => ({
  providerFor: async (a) => fake(a),
  env: { SYNC_POLL_SEC: 120, SYNC_MAX_STALENESS_SEC: 300 },
  aiClassifyFor: (ws) =>
    aiClassifierFor(P(), clock, ws, {
      ...OUT,
      fetchFn: async (_u, o) => {
        calls.n++;
        return ok(await answer(JSON.parse(String(o.body)) as Chat));
      },
    }),
  ...extra,
});
const sync = (clock: ReturnType<typeof fixedClock>, A: EmailAccount, d: SyncDeps) =>
  reconcileAccount(P(), clock, A.id, d);
const reply = (A: EmailAccount, from: string, text = "Hmm.", subject = "Re: Hi") =>
  fake(A).receiveInbound({ from: { email: from }, subject, text });
const thread = (A: EmailAccount) => P().thread.findFirstOrThrow({ where: { accountId: A.id } });

describe("AI reply classifier", () => {
  test("an UNCERTAIN reply becomes INTERESTED with source AI and sets the interest", async () => {
    const { A, leads } = await setup();
    await reply(A, leads[0]!.lead.email);
    const clock = fixedClock(T);
    expect(
      await sync(
        clock,
        A,
        depsWith(clock, () => '{"category":"INTERESTED"}'),
      ),
    ).toBe("caught_up");
    expect(await thread(A)).toMatchObject({ category: "INTERESTED", categorySource: "AI" });
    expect(await P().lead.findUniqueOrThrow({ where: { id: leads[0]!.lead.id } })).toMatchObject({
      interestStatus: 1,
    });
  });

  test("an aiSelectable label is added with LABEL_ADDED; one that is not selectable is ignored", async () => {
    const { A, ws, leads } = await setup();
    await P().leadLabel.createMany({
      data: [
        {
          workspaceId: ws,
          name: "Pricing question",
          color: "#fff",
          aiSelectable: true,
          aiDescription: "asks about price",
        },
        { workspaceId: ws, name: "Secret", color: "#000" },
      ],
    });
    await reply(A, leads[0]!.lead.email);
    await reply(A, "other@x.test", "Hmm, other.");
    const clock = fixedClock(T);
    const prompts: string[] = [];
    const d = depsWith(clock, (b) => {
      prompts.push(b.messages[0]!.content);
      return b.messages[1]!.content.includes("other.")
        ? '{"label":"Secret"}'
        : '{"category":"UNCERTAIN","label":"Pricing question"}';
    });
    await sync(clock, A, d);
    expect(prompts[0]).toContain("asks about price");
    expect(prompts[0]).not.toContain("Secret");
    const lead = await P().lead.findUniqueOrThrow({ where: { id: leads[0]!.lead.id } });
    expect(lead.labels).toEqual(["Pricing question"]);
    expect(
      await P().event.count({ where: { workspaceId: ws, type: "LABEL_ADDED", leadId: lead.id } }),
    ).toBe(1);
    expect(await P().event.count({ where: { workspaceId: ws, type: "LABEL_ADDED" } })).toBe(1);
  });

  test("a label that stopped being aiSelectable before the write is not applied", async () => {
    const { A, ws, leads } = await setup();
    await P().leadLabel.create({
      data: { workspaceId: ws, name: "L", color: "#fff", aiSelectable: true },
    });
    await reply(A, leads[0]!.lead.email);
    const clock = fixedClock(T);
    const d = depsWith(clock, async () => {
      await P().leadLabel.updateMany({ where: { workspaceId: ws }, data: { aiSelectable: false } });
      return '{"label":"L"}';
    });
    await sync(clock, A, d);
    expect((await P().lead.findUniqueOrThrow({ where: { id: leads[0]!.lead.id } })).labels).toEqual(
      [],
    );
  });

  test("an AI timeout leaves the reply UNCERTAIN and the call is logged", async () => {
    const { A, ws, leads } = await setup();
    await reply(A, leads[0]!.lead.email);
    const clock = fixedClock(T);
    const d = depsWith(clock, () => {
      throw new HttpOutError("timeout");
    });
    expect(await sync(clock, A, d)).toBe("caught_up");
    expect(await thread(A)).toMatchObject({ category: "UNCERTAIN" });
    expect(await P().aiCall.findFirstOrThrow({ where: { workspaceId: ws } })).toMatchObject({
      status: "error",
      errorCode: "ai_timeout",
    });
  });

  test("a historical import never calls the AI", async () => {
    const { A, leads } = await setup({ historical: true });
    await reply(A, leads[0]!.lead.email);
    const clock = fixedClock(T);
    const calls = { n: 0 };
    await sync(
      clock,
      A,
      depsWith(clock, () => '{"category":"INTERESTED"}', calls),
    );
    expect(calls.n).toBe(0);
    expect(await thread(A)).toMatchObject({ category: "UNCERTAIN" });
  });

  test("classifierEnabled false: the AI is never called", async () => {
    const { A, leads } = await setup({ classifierEnabled: false });
    await reply(A, leads[0]!.lead.email);
    const clock = fixedClock(T);
    const calls = { n: 0 };
    await sync(
      clock,
      A,
      depsWith(clock, () => '{"category":"INTERESTED"}', calls),
    );
    expect(calls.n).toBe(0);
    expect(await thread(A)).toMatchObject({ category: "UNCERTAIN" });
  });

  test("30 slow classifications under a 5 s lease: the lease is renewed after every call, no lease_lost", async () => {
    const { A } = await setup();
    for (let i = 0; i < 30; i++) await reply(A, `u${i}@x.test`);
    const clock = fixedClock(T);
    const seen: number[] = [];
    const d = depsWith(
      clock,
      async () => {
        const a = await P().emailAccount.findUniqueOrThrow({ where: { id: A.id } });
        expect(a.syncLeaseUntil!.getTime()).toBeGreaterThan(clock.now().getTime()); // still ours
        seen.push(a.syncLeaseUntil!.getTime());
        clock.advance(1000); // a 1 s model call
        return '{"category":"NEUTRAL"}';
      },
      { n: 0 },
      { leaseMs: 5000 },
    );
    expect(await sync(clock, A, d)).toBe("caught_up");
    expect(seen).toHaveLength(30);
    expect(seen.slice(1).every((x, i) => x > seen[i]!)).toBe(true);
    expect((await P().syncRun.findFirstOrThrow({ where: { accountId: A.id } })).error).toBeNull();
  });
});

describe("smart pause", () => {
  const ooo = (A: EmailAccount, from: string) =>
    reply(A, from, "I am away for a while.", "Out of office");
  const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

  test("an OOO with no rule date takes the AI's date", async () => {
    const { A, leads } = await setup();
    await ooo(A, leads[0]!.lead.email);
    const clock = fixedClock(T);
    const until = iso(20);
    await sync(
      clock,
      A,
      depsWith(clock, () => `{"until":"${until}"}`),
    );
    expect((await P().message.findFirstOrThrow({ where: { accountId: A.id } })).oooUntil).toEqual(
      new Date(`${until}T00:00:00Z`),
    );
  });

  test("a date 200 days ahead is ignored", async () => {
    const { A, leads } = await setup();
    await ooo(A, leads[0]!.lead.email);
    const clock = fixedClock(T);
    await sync(
      clock,
      A,
      depsWith(clock, () => `{"until":"${iso(200)}"}`),
    );
    expect(
      (await P().message.findFirstOrThrow({ where: { accountId: A.id } })).oooUntil,
    ).toBeNull();
  });

  test("a rule date wins: the AI is not asked", async () => {
    const { A, leads } = await setup();
    await reply(A, leads[0]!.lead.email, `Back on ${iso(10)}.`, "Out of office");
    const clock = fixedClock(T);
    const calls = { n: 0 };
    await sync(
      clock,
      A,
      depsWith(clock, () => '{"until":null}', calls),
    );
    expect(calls.n).toBe(0);
  });
});

test("thumbs: aiFeedback is stored and audited", async () => {
  const { A, ws, leads } = await setup();
  await reply(A, leads[0]!.lead.email);
  const clock = fixedClock(T);
  await sync(
    clock,
    A,
    depsWith(clock, () => '{"category":"INTERESTED"}'),
  );
  const m = await P().message.findFirstOrThrow({ where: { accountId: A.id } });
  await setAiFeedback(P(), clock, ws, "u1", m.id, -1);
  expect((await P().message.findUniqueOrThrow({ where: { id: m.id } })).aiFeedback).toBe(-1);
  expect(
    await P().auditLog.count({ where: { workspaceId: ws, action: "ai.feedback", actorId: "u1" } }),
  ).toBe(1);
  await expect(setAiFeedback(P(), clock, "other", "u1", m.id, 1)).rejects.toMatchObject({
    status: 404,
  });
});
