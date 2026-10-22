import type { AccountProvider, PrismaClient } from "@rightnow/db/client";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { isValidTimeZone } from "../schedule";
import { unsubscribeMode } from "../unsubscribe";
import type { EspRule } from "./schema";
import { CampaignError, liveCampaign } from "./service";
import { lockEnrollment } from "./hooks";
import { OPEN_STATES_SQL } from "./lead-status";

export type DnsFinding = {
  domain: string;
  level: "ok" | "warn" | "block";
  reason: string;
  fix?: string;
};
export type LaunchIssue = {
  code: string;
  level: "block" | "warn";
  message: string;
  [k: string]: unknown;
};
export type LaunchDeps = {
  dnsGate?: (domains: string[]) => Promise<DnsFinding[]>;
  appUrl: string;
  /** Providers allowed to send for real (D17); anything else is warned about. */
  sendable: AccountProvider[];
  /** Step/lead/variant checks: `campaignContentIssues` (sequence.ts). */
  contentIssues: (campaignId: string, ws: string) => Promise<LaunchIssue[]>;
};

const ESP_OF = { GMAIL: "google", MICROSOFT: "outlook", SMTP: "other" } as const;
const block = (code: string, message: string, extra: object = {}): LaunchIssue => ({
  code,
  level: "block",
  message,
  ...extra,
});
const warn = (code: string, message: string, extra: object = {}): LaunchIssue => ({
  code,
  level: "warn",
  message,
  ...extra,
});

type Opts = { overrideDnsWarnings?: boolean };
type Result = { status: "ACTIVE"; warnings: LaunchIssue[] };
const FROM = {
  launch: ["DRAFT", "PAUSED"],
  // COMPLETED (gate I-4, D25): leads enrolled after the campaign finished are sent once the user resumes it
  resume: ["PAUSED", "ACCOUNTS_UNHEALTHY", "BOUNCE_PROTECT", "COMPLETED"],
} as const;

/**
 * Validates everything and returns ALL blocking reasons at once (422 `issues`). The DNS gate runs before the
 * transaction opens (no network inside a transaction). Idempotent on ACTIVE (current warnings only).
 */
export const launchCampaign = (
  prisma: PrismaClient,
  clock: Clock,
  deps: LaunchDeps,
  ws: string,
  id: string,
  actorId: string | null | undefined,
  opts: Opts = {},
) => activate("launch", prisma, clock, deps, ws, id, actorId, opts);

/**
 * Resume re-runs launch validation: a paused campaign whose accounts, schedule or address went away stays paused. A
 * COMPLETED campaign resumes too, so leads added after it finished are sent (housekeeping completes it again).
 */
export const resumeCampaign = (
  prisma: PrismaClient,
  clock: Clock,
  deps: LaunchDeps,
  ws: string,
  id: string,
  actorId: string | null | undefined,
  opts: Opts = {},
) => activate("resume", prisma, clock, deps, ws, id, actorId, opts);

async function activate(
  kind: keyof typeof FROM,
  prisma: PrismaClient,
  clock: Clock,
  deps: LaunchDeps,
  ws: string,
  id: string,
  actorId: string | null | undefined,
  opts: Opts,
): Promise<Result> {
  const c = await liveCampaign(prisma, ws, id);
  const active = kind === "launch" && c.status === "ACTIVE";
  if (!active && !(FROM[kind] as readonly string[]).includes(c.status))
    throw new CampaignError(409, `cannot_${kind}_${c.status.toLowerCase()}`);
  if (c.status === "COMPLETED" && c.endAt && c.endAt <= clock.now())
    throw new CampaignError(409, "campaign_ended", {
      message: "This campaign's end date has passed. Change the end date to resume it.",
    });

  const [w, schedules, links] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: ws } }),
    prisma.campaignSchedule.findMany({ where: { campaignId: id } }),
    prisma.campaignAccount.findMany({
      where: { campaignId: id, account: { workspaceId: ws, deletedAt: null } },
      include: { account: true },
    }),
  ]);
  // Usable = assigned, live, not paused or broken, and inside the campaign's tag restriction.
  const usable = links
    .map((l) => l.account)
    .filter(
      (a) =>
        a.lifecycle !== "PAUSED" &&
        a.lifecycle !== "NEEDS_ATTENTION" &&
        (!c.accountTags.length || a.tags.some((t) => c.accountTags.includes(t))),
    );

  const warnings: LaunchIssue[] = [];
  if (unsubscribeMode(deps.appUrl) === "mailto")
    warnings.push(
      warn("unsubscribe_mailto_only", "Unsubscribe links need a public https APP_URL; mailto only"),
    );
  if (c.minGapSec < 300) warnings.push(warn("gap_below_5_min", "Gap below 5 minutes"));
  const send = (c.espRoutingRules as EspRule[]).filter((r) => r.action === "send");
  if (
    send.length &&
    !usable.some((a) =>
      send.some((r) => r.senderEsp === "all" || r.senderEsp === ESP_OF[a.provider]),
    )
  )
    warnings.push(warn("no_matching_esp", "No assigned account matches a send routing rule"));
  const unverified = [...new Set(usable.map((a) => a.provider))].filter(
    (p) => !deps.sendable.includes(p),
  );
  if (unverified.length)
    warnings.push(
      warn(
        "provider_not_verified",
        "Real sending is off until live verification passes (docs/ops/LIVE_VERIFICATION.md)",
        { providers: unverified },
      ),
    );
  if (active) return { status: "ACTIVE", warnings };

  const issues: LaunchIssue[] = [];
  if (!usable.length)
    issues.push(
      block("no_accounts", "Assign at least one usable account (live, not paused, matching tags)"),
    );
  issues.push(...(await deps.contentIssues(id, ws)));
  if (!schedules.length) issues.push(block("no_schedule", "Add a sending schedule"));
  for (const s of schedules)
    if (s.days < 1 || s.days > 127 || !isValidTimeZone(s.timezone))
      issues.push(
        block("invalid_schedule", `Schedule "${s.name}" is invalid`, { scheduleId: s.id }),
      );
  if (!w.physicalAddress?.trim())
    issues.push(block("no_physical_address", "Set the workspace physical address"));
  const tracking = (c.trackOpens && !w.disableOpenTracking && !c.textOnly) || c.trackClicks;
  const untracked = usable.filter((a) => a.trackingDomain && a.trackingDomainStatus !== "VERIFIED");
  if (tracking && untracked.length)
    issues.push(
      block("tracking_domain_unverified", "Verify the tracking domain", {
        accountIds: untracked.map((a) => a.id),
      }),
    );

  // Network call: before any transaction.
  const domains = [...new Set(usable.map((a) => a.email.split("@")[1]!))];
  const dns = deps.dnsGate && domains.length ? await deps.dnsGate(domains) : [];
  for (const f of dns.filter((f) => f.level === "block"))
    issues.push(block("dns_block", f.reason, { domain: f.domain, fix: f.fix }));
  const dnsWarn = dns.filter((f) => f.level === "warn");
  if (!opts.overrideDnsWarnings)
    for (const f of dnsWarn)
      issues.push(block("dns_warn", f.reason, { domain: f.domain, fix: f.fix }));

  if (issues.length) throw new CampaignError(422, "launch_blocked", { issues });

  await prisma.$transaction(async (tx) => {
    const now = clock.now();
    // Same lock as enrollment: two DRAFT campaigns sharing a lead cannot both turn live (PS-LEAD-02 conflict rule).
    await lockEnrollment(tx, ws);
    const [clash] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT cl."leadId") AS n
      FROM "CampaignLead" cl
      JOIN "CampaignLead" o ON o."leadId" = cl."leadId" AND o."campaignId" <> cl."campaignId"
        AND o."state" = ANY(${OPEN_STATES_SQL})
      JOIN "Campaign" oc ON oc."id" = o."campaignId" AND oc."deletedAt" IS NULL
        AND oc."status" IN ('ACTIVE', 'PAUSED', 'ACCOUNTS_UNHEALTHY', 'BOUNCE_PROTECT')
      WHERE cl."campaignId" = ${id} AND cl."state" = ANY(${OPEN_STATES_SQL}) AND NOT cl."duplicateOk"`;
    if (clash && clash.n > 0n)
      throw new CampaignError(422, "launch_blocked", {
        issues: [
          block(
            "leads_in_other_active_campaign",
            "Some leads are already in another live campaign; remove them or enroll with allowDuplicates",
            { leads: Number(clash.n) },
          ),
        ],
      });
    const r = await tx.campaign.updateMany({
      where: { id, workspaceId: ws, deletedAt: null, status: { in: [...FROM[kind]] } },
      data: { status: "ACTIVE", launchedAt: c.launchedAt ?? now },
    });
    if (r.count !== 1) throw new CampaignError(409, "status_changed");
    const a = { workspaceId: ws, actorId, at: now };
    await audit(tx, a, `campaign.${kind}`, id, { warnings: warnings.map((x) => x.code) });
    if (opts.overrideDnsWarnings && dnsWarn.length)
      await audit(tx, a, "campaign.dns_override", id, { domains: dnsWarn.map((f) => f.domain) });
  });
  return { status: "ACTIVE", warnings };
}
