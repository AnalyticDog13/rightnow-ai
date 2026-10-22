import type { AccountProvider, PrismaClient } from "@rightnow/db/client";
import { AmbiguousSendError, AuthError, newMessageId } from "@rightnow/providers";
import { z } from "zod";
import { recordProviderError } from "../accounts/health";
import { dayKey } from "../accounts/daykey";
import { maxDailyLimit } from "../accounts/factory";
import { AccountError, live } from "../accounts/service";
import { audit } from "../audit";
import { previewMessage } from "../campaigns/preview";
import type { Clock } from "../clock";
import { sendableProviders } from "../dispatch";
import { getEnv, type Env } from "../env";
import { codeOf } from "../mail/ingest";
import type { SyncDeps } from "../mail/sync";
import type { RenderEnv } from "../unsubscribe";
import type { DomainReport } from "./dns";

type Actor = string | null | undefined;

export const placementInput = z.union([
  z.strictObject({ accountId: z.string().min(1), variantId: z.string().min(1).optional() }),
  z.strictObject({
    accountId: z.string().min(1),
    subject: z.string().trim().min(1).max(500),
    body: z.string().min(1).max(100_000),
  }),
]);
export type PlacementInput = z.infer<typeof placementInput>;

/**
 * D37: one message per opted-in seed mailbox of the workspace, sent through the tested account. The seeds' own
 * mailboxes say where it landed (sync sees INBOX, `warmupTick` locates the rest after 10 min). Counts against the
 * account's daily quota like a manual reply: one guarded upsert in the same transaction as the rows (M10).
 */
export async function startPlacementTest(
  prisma: PrismaClient,
  clock: Clock,
  deps: {
    providerFor: SyncDeps["providerFor"];
    renderEnv: RenderEnv;
    env?: Pick<Env, "MAIL_PROVIDER_FAKE">; // tests: the D17 gate without a ProviderVerification row
  },
  ws: string,
  actor: Actor,
  input: PlacementInput,
): Promise<{ id: string }> {
  const a = await live(prisma, ws, input.accountId);
  const sendable = await sendableProviders(prisma, deps.env ?? getEnv());
  // "sendable" is the claim's account rule without the freshness term (Rev 2 I7)
  if (
    a.status !== "CONNECTED" ||
    !a.credentialsEnc ||
    !["ACTIVE", "REWARMING"].includes(a.lifecycle) ||
    !sendable.includes(a.provider)
  )
    throw new AccountError(409, "account_unavailable");
  const seeds = await prisma.emailAccount.findMany({
    where: {
      workspaceId: ws,
      id: { not: a.id },
      placementSeed: true,
      deletedAt: null,
      status: "CONNECTED",
      credentialsEnc: { not: null },
      lifecycle: { not: "NEEDS_ATTENTION" },
      provider: { in: sendable },
    },
    orderBy: [{ provider: "asc" }, { email: "asc" }],
  });
  if (!seeds.length) throw new AccountError(409, "no_seeds");

  // Same render as the campaign test-send (D25 M-5): dead unsubscribe text, no tracking, no List-Unsubscribe.
  let content: { subject: string; text: string; html?: string | null };
  if ("body" in input) content = { subject: input.subject, text: input.body };
  else if (input.variantId) {
    const v = await prisma.stepVariant.findFirst({
      where: { id: input.variantId, step: { campaign: { workspaceId: ws, deletedAt: null } } },
      include: { step: true },
    });
    if (!v) throw new AccountError(404, "Not found");
    const { campaignId, id: stepId } = v.step;
    const leadId =
      (await prisma.campaignLead.findFirst({ where: { campaignId }, select: { leadId: true } }))
        ?.leadId ??
      (
        await prisma.lead.findFirst({
          where: { workspaceId: ws, deletedAt: null },
          select: { id: true },
        })
      )?.id;
    if (!leadId) throw new AccountError(422, "no_lead_to_render");
    const r = await previewMessage(
      prisma,
      ws,
      { campaignId, stepId, variantId: v.id, leadId, accountId: a.id },
      deps.renderEnv,
    );
    if (r.issues.length) throw new AccountError(422, "preview_has_issues", { issues: r.issues });
    content = r;
  } else
    content = {
      subject: "RightNow placement test",
      text: "This is an inbox placement test sent from RightNow. No reply is needed.",
    };

  const now = clock.now();
  const day = new Date(`${dayKey(a.timezone, now)}T00:00:00Z`);
  const units = seeds.length;
  const cap = maxDailyLimit(a.providerCap);
  const domain = a.email.split("@").pop()!;
  const { test, rows } = await prisma.$transaction(async (tx) => {
    const ok = await tx.$queryRaw<unknown[]>`
      INSERT INTO "AccountDailyUsage" ("accountId", day, sent, reserved)
      SELECT ${a.id}, ${day}, ${units}::int, 0 WHERE ${units}::int <= ${cap}::int
      ON CONFLICT ("accountId", day) DO UPDATE SET sent = "AccountDailyUsage".sent + ${units}::int
      WHERE "AccountDailyUsage".sent + "AccountDailyUsage".reserved + ${units}::int <= ${cap}::int
      RETURNING 1`;
    if (!ok.length) throw new AccountError(409, "provider_cap");
    const test = await tx.placementTest.create({
      data: { workspaceId: ws, accountId: a.id, subject: content.subject, createdAt: now },
    });
    const rows = [];
    for (const s of seeds)
      rows.push(
        await tx.warmupMessage.create({
          data: {
            workspaceId: ws,
            fromAccountId: a.id,
            toAccountId: s.id,
            kind: "PLACEMENT",
            status: "PLANNED",
            rfcMessageId: newMessageId(domain),
            subject: content.subject,
            placementTestId: test.id,
            dueAt: now,
          },
        }),
      );
    await audit(tx, { workspaceId: ws, actorId: actor, at: now }, "placement.start", a.id, {
      testId: test.id,
      seeds: units,
    });
    return { test, rows };
  });

  // outside the transaction: a failed send is that seed's MISSING; an unknown outcome stays SENT and is located (never resent)
  const fail = (id: string, e: unknown) =>
    prisma.warmupMessage.updateMany({
      where: { id, status: "SENDING" },
      data: { status: "FAILED", error: codeOf(e) },
    });
  let provider;
  try {
    provider = await deps.providerFor(a);
  } catch (e) {
    for (const r of rows) await fail(r.id, e);
    if (e instanceof AuthError) await recordProviderError(prisma, clock, a.id, e);
    return { id: test.id };
  }
  for (const [i, r] of rows.entries()) {
    const claim = await prisma.warmupMessage.updateMany({
      where: { id: r.id, status: "PLANNED" },
      data: { status: "SENDING", sentAt: clock.now() },
    });
    if (!claim.count) continue;
    try {
      await provider.send(
        {
          from: { email: a.email, name: a.fromName },
          to: [{ email: seeds[i]!.email }],
          replyTo: a.replyTo ? { email: a.replyTo } : undefined,
          subject: content.subject,
          text: content.text,
          html: content.html ?? undefined,
          messageId: r.rfcMessageId,
          headers: { "X-RightNow-Test": "1" },
        },
        { signal: AbortSignal.timeout(60_000) },
      );
      await prisma.warmupMessage.updateMany({
        where: { id: r.id, status: "SENDING" },
        data: { status: "SENT", sentAt: clock.now() },
      });
    } catch (e) {
      if (e instanceof AmbiguousSendError)
        await prisma.warmupMessage.updateMany({
          where: { id: r.id, status: "SENDING" },
          data: { status: "SENT", sentAt: clock.now(), error: "ambiguous_send" },
        });
      else {
        await fail(r.id, e);
        if (e instanceof AuthError) await recordProviderError(prisma, clock, a.id, e);
      }
    }
  }
  return { id: test.id };
}

type Folder = "INBOX" | "SPAM" | "OTHER" | "MISSING" | "PENDING";
const ESP: Record<AccountProvider, "Gmail" | "Microsoft" | "Other"> = {
  GMAIL: "Gmail",
  MICROSOFT: "Microsoft",
  SMTP: "Other",
};

export async function placementReport(
  prisma: Pick<PrismaClient, "placementTest" | "warmupMessage" | "domainCheck" | "emailAccount">,
  ws: string,
  id: string,
): Promise<{
  id: string;
  accountId: string;
  subject: string;
  createdAt: Date;
  finishedAt: Date | null;
  seeds: {
    accountId: string;
    email: string;
    esp: "Gmail" | "Microsoft" | "Other";
    folder: Folder;
  }[];
  dnsbl: DomainReport["dnsbl"] | null;
  spamAssassin: "not provided";
}> {
  const t = await prisma.placementTest.findFirst({ where: { id, workspaceId: ws } });
  if (!t) throw new AccountError(404, "Not found");
  const [rows, a] = await Promise.all([
    prisma.warmupMessage.findMany({
      where: { placementTestId: id, workspaceId: ws },
      include: { to: { select: { email: true, provider: true } } },
    }),
    prisma.emailAccount.findUnique({ where: { id: t.accountId }, select: { email: true } }),
  ]);
  const check = a
    ? await prisma.domainCheck.findUnique({
        where: {
          workspaceId_domain: { workspaceId: ws, domain: a.email.split("@").pop()!.toLowerCase() },
        },
      })
    : null;
  const seeds = rows
    .map((r) => ({
      accountId: r.toAccountId,
      email: r.to.email,
      esp: ESP[r.to.provider],
      folder: (r.landedFolder ?? (r.status === "FAILED" ? "MISSING" : "PENDING")) as Folder,
    }))
    .sort((x, y) => x.esp.localeCompare(y.esp) || x.email.localeCompare(y.email));
  const rep = check?.report as Partial<DomainReport> | null;
  return {
    id,
    accountId: t.accountId,
    subject: t.subject,
    createdAt: t.createdAt,
    finishedAt: t.finishedAt,
    seeds,
    dnsbl: rep?.dnsbl ?? null,
    spamAssassin: "not provided", // no spamd
  };
}

export async function listPlacementTests(prisma: PrismaClient, ws: string) {
  return prisma.placementTest.findMany({
    where: { workspaceId: ws },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, accountId: true, subject: true, createdAt: true, finishedAt: true },
  });
}
