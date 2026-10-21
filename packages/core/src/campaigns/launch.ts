import type { AccountProvider, PrismaClient } from "@rightnow/db/client";
import { audit } from "../audit";
import type { Clock } from "../clock";
import { isValidTimeZone } from "../schedule";
import { unsubscribeMode } from "../unsubscribe";
import type { EspRule } from "./schema";
import { CampaignError, liveCampaign } from "./service";

export type DnsFinding = { domain: string; level: "ok" | "warn" | "block"; reason: string };
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
  /** Step/lead/variant checks (no_leads, no_steps, missing_*, template_error). T06 supplies the real one. */
  contentIssues?: (campaignId: string) => Promise<LaunchIssue[]>;
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

/**
 * Validates everything and returns ALL blocking reasons at once (422 `issues`). The DNS gate runs before the
 * transaction opens (no network inside a transaction). Idempotent on ACTIVE.
 */
export async function launchCampaign(
  prisma: PrismaClient,
  clock: Clock,
  deps: LaunchDeps,
  ws: string,
  id: string,
  actorId: string | null | undefined,
  opts: { overrideDnsWarnings?: boolean } = {},
): Promise<{ status: "ACTIVE"; warnings: LaunchIssue[] }> {
  const c = await liveCampaign(prisma, ws, id);
  if (c.status === "ACTIVE") return { status: "ACTIVE", warnings: [] };
  if (c.status !== "DRAFT" && c.status !== "PAUSED")
    throw new CampaignError(409, `cannot_launch_${c.status.toLowerCase()}`);

  const [w, schedules, links] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: ws } }),
    prisma.campaignSchedule.findMany({ where: { campaignId: id } }),
    prisma.campaignAccount.findMany({
      where: { campaignId: id, account: { workspaceId: ws, deletedAt: null } },
      include: { account: true },
    }),
  ]);
  const accounts = links.map((l) => l.account);
  const usable = c.accountTags.length
    ? accounts.filter((a) => a.tags.some((t) => c.accountTags.includes(t)))
    : accounts;

  const issues: LaunchIssue[] = [];
  if (!usable.length)
    issues.push(
      block(
        "no_accounts",
        accounts.length ? "No assigned account has a required tag" : "Assign at least one account",
      ),
    );
  // Steps and leads come from T06; until it ships there are none, so the default always blocks.
  issues.push(
    ...(deps.contentIssues
      ? await deps.contentIssues(id)
      : [block("no_leads", "Add leads"), block("no_steps", "Add a first step")]),
  );
  if (!schedules.length) issues.push(block("no_schedule", "Add a sending schedule"));
  for (const s of schedules)
    if (s.days < 1 || s.days > 127 || !isValidTimeZone(s.timezone))
      issues.push(
        block("invalid_schedule", `Schedule "${s.name}" is invalid`, { scheduleId: s.id }),
      );
  if (!w.physicalAddress?.trim())
    issues.push(block("no_physical_address", "Set the workspace physical address"));
  const tracking = (c.trackOpens && !w.disableOpenTracking && !c.textOnly) || c.trackClicks;
  const untracked = accounts.filter(
    (a) => a.trackingDomain && a.trackingDomainStatus !== "VERIFIED",
  );
  if (tracking && untracked.length)
    issues.push(
      block("tracking_domain_unverified", "Verify the tracking domain", {
        accountIds: untracked.map((a) => a.id),
      }),
    );

  // Network call: before any transaction.
  const domains = [...new Set(accounts.map((a) => a.email.split("@")[1]!))];
  const dns = deps.dnsGate && domains.length ? await deps.dnsGate(domains) : [];
  for (const f of dns.filter((f) => f.level === "block"))
    issues.push(block("dns_block", f.reason, { domain: f.domain }));
  const dnsWarn = dns.filter((f) => f.level === "warn");
  if (!opts.overrideDnsWarnings)
    for (const f of dnsWarn) issues.push(block("dns_warn", f.reason, { domain: f.domain }));

  if (issues.some((i) => i.level === "block"))
    throw new CampaignError(422, "launch_blocked", { issues });

  const warnings: LaunchIssue[] = [];
  if (unsubscribeMode(deps.appUrl) === "mailto")
    warnings.push(
      warn("unsubscribe_mailto_only", "Unsubscribe links need a public https APP_URL; mailto only"),
    );
  if (c.minGapSec < 300) warnings.push(warn("gap_below_5_min", "Gap below 5 minutes"));
  const rules = c.espRoutingRules as EspRule[];
  if (
    rules.length &&
    !usable.some((a) =>
      rules.some(
        (r) => r.action === "send" && (r.senderEsp === "all" || r.senderEsp === ESP_OF[a.provider]),
      ),
    )
  )
    warnings.push(warn("no_matching_esp", "No assigned account matches a send routing rule"));
  const unverified = [...new Set(accounts.map((a) => a.provider))].filter(
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

  await prisma.$transaction(async (tx) => {
    const now = clock.now();
    const r = await tx.campaign.updateMany({
      where: { id, workspaceId: ws, deletedAt: null, status: { in: ["DRAFT", "PAUSED"] } },
      data: { status: "ACTIVE", launchedAt: c.launchedAt ?? now },
    });
    if (r.count !== 1) throw new CampaignError(409, "status_changed");
    const a = { workspaceId: ws, actorId, at: now };
    await audit(tx, a, "campaign.launch", id, { warnings: warnings.map((x) => x.code) });
    if (opts.overrideDnsWarnings && dnsWarn.length)
      await audit(tx, a, "campaign.dns_override", id, { domains: dnsWarn.map((f) => f.domain) });
  });
  return { status: "ACTIVE", warnings };
}
