import { randomBytes } from "node:crypto";
import type { EventType, Prisma, PrismaClient } from "@rightnow/db/client";
import { ensureStages } from "../src/crm/stages";
import { planRow } from "./campaign-fixture";

const hex = () => randomBytes(6).toString("hex");
export const AT = (iso: string) => new Date(iso);
const D2 = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m)); // 2026-11-02, UTC

/**
 * The P6-T03 exact fixture (brief, Review Focus 2). Campaign C on 2026-11-02: steps S1 (A, B), S2 (A); accounts X, Y;
 * leads L1 (GOOGLE, list K, tag vip), L2–L5 (MICROSOFT). Campaign C2: L1 on 11-01 (outside the range), L2 on 11-02.
 * Noise that must not count: untargeted DSN and ARF, forged repeat bounces/complaints, a machine open, a scanner click,
 * an auto-reply, an event on 11-03.
 */
export async function analyticsFixture(P: PrismaClient) {
  const tag = hex();
  const ws = (
    await P.workspace.create({ data: { name: "W", slug: `w-${tag}`, physicalAddress: "1 Main" } })
  ).id;
  const acct = (name: string) =>
    P.emailAccount.create({
      data: {
        workspaceId: ws,
        provider: "SMTP",
        email: `${name}-${tag}@send.test`,
        fromName: name,
        firstName: name,
        lastName: "S",
        capTier: "SMTP",
        providerCap: 500,
      },
    });
  const X = await acct("x");
  const Y = await acct("y");
  const C = await P.campaign.create({
    data: { workspaceId: ws, name: "Campaign C", status: "ACTIVE", tags: ["q4"], ownerId: "u1" },
  });
  const C2 = await P.campaign.create({
    data: { workspaceId: ws, name: "Campaign C2", status: "ACTIVE" },
  });
  const step = async (campaignId: string, order: number, labels: string[]) => {
    const s = await P.sequenceStep.create({ data: { campaignId, order, delayValue: 0 } });
    const v: Record<string, { id: string }> = {};
    for (const label of labels)
      v[label] = await P.stepVariant.create({
        data: { stepId: s.id, label, subject: "Hi", body: "Hello" },
      });
    return { ...s, v };
  };
  const S1 = await step(C.id, 1, ["A", "B"]);
  const S2 = await step(C.id, 2, ["A"]);
  const T1 = await step(C2.id, 1, ["A"]);
  const K = await P.leadList.create({ data: { workspaceId: ws, name: `K-${tag}` } });
  const L: { id: string; email: string }[] = [];
  for (let i = 1; i <= 5; i++)
    L.push(
      await P.lead.create({
        data: {
          workspaceId: ws,
          email: `l${i}-${tag}@lead${i}.test`,
          espType: i === 1 ? "GOOGLE" : "MICROSOFT",
          tags: i === 1 ? ["vip"] : [],
        },
      }),
    );
  const [L1, L2, L3, L4, L5] = L as [
    (typeof L)[0],
    (typeof L)[0],
    (typeof L)[0],
    (typeof L)[0],
    (typeof L)[0],
  ];
  await P.leadListMember.create({ data: { listId: K.id, leadId: L1.id } });
  const cl = new Map<string, string>();
  const enrol = async (campaignId: string, leadId: string) => {
    const k = `${campaignId}:${leadId}`;
    if (!cl.has(k))
      cl.set(
        k,
        (
          await P.campaignLead.create({
            data: { workspaceId: ws, campaignId, leadId, state: "ACTIVE" },
          })
        ).id,
      );
    return cl.get(k)!;
  };
  type Send = {
    campaignId: string;
    stepId: string;
    variantId: string;
    accountId: string;
    scheduledMessageId: string;
    leadId: string;
  };
  const send = async (
    campaignId: string,
    lead: { id: string },
    s: { id: string },
    variantId: string,
    accountId: string,
  ): Promise<Send> => {
    const campaignLeadId = await enrol(campaignId, lead.id);
    const sm = await planRow(P, {
      workspaceId: ws,
      campaignId,
      campaignLeadId,
      stepId: s.id,
      variantId,
      accountId,
      dueAt: D2(9),
      status: "SENT",
    });
    return {
      campaignId,
      stepId: s.id,
      variantId,
      accountId,
      scheduledMessageId: sm.id,
      leadId: lead.id,
    };
  };
  const ev = (
    type: EventType,
    at: Date,
    o: Partial<Prisma.EventUncheckedCreateInput> = {},
  ): Prisma.EventCreateManyInput => ({
    workspaceId: ws,
    type,
    occurredAt: at,
    dedupeKey: `fx:${hex()}`,
    ...o,
  });

  const s1aL1 = await send(C.id, L1, S1, S1.v.A!.id, X.id);
  const s1bL2 = await send(C.id, L2, S1, S1.v.B!.id, X.id);
  const s1aL3 = await send(C.id, L3, S1, S1.v.A!.id, Y.id);
  const s1bL4 = await send(C.id, L4, S1, S1.v.B!.id, Y.id);
  const s2aL1 = await send(C.id, L1, S2, S2.v.A!.id, X.id);
  const s1aL5 = await send(C.id, L5, S1, S1.v.A!.id, X.id); // SEND_FAILED, never accepted
  const c2L1 = await send(C2.id, L1, T1, T1.v.A!.id, X.id);
  const c2L2 = await send(C2.id, L2, T1, T1.v.A!.id, Y.id);

  const untargeted = (s: Send) => ({ ...s, scheduledMessageId: null });
  await P.event.createMany({
    data: [
      ev("ACCEPTED", D2(9, 0), s1aL1),
      ev("ACCEPTED", D2(9, 1), s1bL2),
      ev("ACCEPTED", D2(9, 2), s1aL3),
      ev("ACCEPTED", D2(9, 3), s1bL4),
      ev("ACCEPTED", D2(11, 0), s2aL1),
      ev("OPEN", D2(10, 0), { ...s1aL1, isEstimated: true, meta: { machine: false } }),
      ev("OPEN", D2(10, 5), { ...s1aL1, isEstimated: true, meta: { machine: false } }),
      ev("OPEN", D2(9, 1), { ...s1bL2, isEstimated: true, meta: { machine: true } }),
      ev("CLICK", D2(10, 6), { ...s1aL1, meta: { scanner: false, url: "https://acme.test/p" } }),
      ev("CLICK", D2(9, 3), { ...s1aL3, meta: { scanner: true, url: "https://acme.test/p" } }),
      ev("REPLY", D2(12, 0), { ...s2aL1, meta: { category: "INTERESTED" } }),
      // received in X's mailbox, but sent by Y: the account view credits Y (M5)
      ev("REPLY", D2(12, 5), { ...s1aL3, accountId: X.id, meta: { category: "INTERESTED" } }),
      ev("AUTO_REPLY", D2(9, 30), s1bL4),
      ev("BOUNCE_HARD", D2(9, 10), { ...s1bL2, meta: { reason: "550 5.1.1 user unknown" } }),
      ev("BOUNCE_HARD", D2(9, 11), { ...s1bL2, meta: { reason: "550 5.1.1 user unknown" } }),
      ev("BOUNCE_HARD", D2(9, 12), { ...untargeted(s1bL4), meta: { reason: "forged" } }),
      ev("BOUNCE_SOFT", D2(9, 13), { ...s1bL4, meta: { reason: "mailbox full" } }),
      ev("SEND_FAILED", D2(9, 4), {
        ...s1aL5,
        meta: { scope: "recipient", error: "550 no such user" },
      }),
      ev("COMPLAINT", D2(13, 0), s1aL3),
      ev("COMPLAINT", D2(13, 1), s1aL3),
      ev("COMPLAINT", D2(13, 2), untargeted(s1bL4)),
      ev("UNSUBSCRIBE", D2(13, 3), s1aL3),
      ev("MEETING", D2(14, 0), { ...untargeted(s2aL1) }),
      ev("OPEN", AT("2026-11-03T00:30:00Z"), { ...s2aL1, meta: { machine: false } }), // outside the range
      ev("ACCEPTED", AT("2026-11-01T10:00:00Z"), c2L1),
      ev("ACCEPTED", D2(9, 0), c2L2),
    ],
  });
  await P.campaignLead.update({
    where: { id: cl.get(`${C.id}:${L4.id}`)! },
    data: { state: "COMPLETED", completedAt: D2(15) },
  });
  const stages = await ensureStages(P, ws);
  const st = (name: string) => stages.find((s) => s.name === name)!.id;
  const won = await P.opportunity.create({
    data: {
      workspaceId: ws,
      leadId: L1.id,
      campaignId: C.id,
      stageId: st("Closed Won"),
      title: "L1",
      value: 1000,
      cashCollected: 800,
      closedAt: D2(16),
      createdAt: D2(12, 1),
      stepId: S2.id,
      variantId: S2.v.A!.id,
      accountId: X.id,
    },
  });
  const open = await P.opportunity.create({
    data: {
      workspaceId: ws,
      leadId: L3.id,
      campaignId: C.id,
      stageId: st("Interested"),
      title: "L3",
      value: 500,
      createdAt: D2(12, 6),
      stepId: S1.id,
      variantId: S1.v.A!.id,
      accountId: Y.id,
    },
  });
  return {
    ws,
    X,
    Y,
    C,
    C2,
    S1,
    S2,
    K,
    L1,
    L2,
    L3,
    L4,
    L5,
    st,
    won,
    open,
    send,
    ev,
    sends: { s1aL1, s1bL2, s1aL3, s1bL4, s2aL1 },
  };
}

/** The fixture's day as an analytics query (UTC), plus overrides. */
export const day2 = (o: Record<string, unknown> = {}) => ({
  from: "2026-11-02",
  to: "2026-11-02",
  ...o,
});
