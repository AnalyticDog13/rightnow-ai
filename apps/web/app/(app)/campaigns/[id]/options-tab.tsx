"use client";

import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { call, errorText } from "../../accounts/api-client";
import type { CampaignView } from "./campaign-builder";

type Kind = "bool" | "int" | "list" | "text" | "metric";
const METRICS = [
  ["reply", "Reply rate"],
  ["click", "Click rate"],
  ["open", "Open rate (estimated)"],
];
const FIELDS: { k: string; label: string; kind: Kind; hint?: string }[] = [
  { k: "name", label: "Campaign name", kind: "text" },
  { k: "tags", label: "Tags (comma separated)", kind: "list" },
  { k: "evergreen", label: "Evergreen (keep adding new leads)", kind: "bool" },
  { k: "dailyLimit", label: "Daily limit", kind: "int", hint: "Empty means no campaign limit." },
  {
    k: "maxNewLeadsPerDay",
    label: "Max new leads per day",
    kind: "int",
    hint: "0 sends no first emails.",
  },
  { k: "perCompanyDailyLimit", label: "Per-company daily limit", kind: "int" },
  { k: "minGapSec", label: "Minimum gap between emails (seconds)", kind: "int" },
  { k: "randomGapSec", label: "Random extra gap (seconds)", kind: "int" },
  { k: "stopOnReply", label: "Stop on reply", kind: "bool" },
  { k: "stopOnAutoReply", label: "Stop on auto-reply", kind: "bool" },
  { k: "stopForCompanyOnReply", label: "Stop for the whole company on reply", kind: "bool" },
  { k: "trackOpens", label: "Track opens", kind: "bool" },
  { k: "trackClicks", label: "Track clicks", kind: "bool" },
  { k: "textOnly", label: "Text only", kind: "bool" },
  { k: "firstEmailTextOnly", label: "First email text only", kind: "bool" },
  { k: "prioritizeNewLeads", label: "Prioritize new leads", kind: "bool" },
  { k: "matchProvider", label: "Match lead's email provider", kind: "bool" },
  { k: "allowRisky", label: "Email risky addresses", kind: "bool" },
  { k: "bounceProtect", label: "Bounce protection", kind: "bool" },
  { k: "unsubscribeLink", label: "Include unsubscribe link in the footer", kind: "bool" },
  { k: "optOutText", label: "Opt-out message", kind: "text" },
  { k: "cc", label: "CC (comma separated)", kind: "list" },
  { k: "bcc", label: "BCC (comma separated)", kind: "list" },
  { k: "plValue", label: "Pipeline value per lead", kind: "int" },
  { k: "abAutoOptimize", label: "Auto-optimize A/Z", kind: "bool" },
  {
    k: "abWinnerMetric",
    label: "Winner metric",
    kind: "metric",
    hint: "Needs at least 100 sends per variant.",
  },
  { k: "abResetDaily", label: "Reset variant balance daily", kind: "bool" },
];
// Same text as DEFAULT_OPT_OUT_TEXT in @rightnow/core (a client component cannot import it).
const DEFAULT_OPT_OUT = 'Not interested? Just reply "unsubscribe" and I won\'t email you again.';
type Rule = { action: string; recipientEsp: string; senderEsp: string };
const ESP = ["all", "google", "outlook", "other"];
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

const show = (v: unknown, kind: Kind) =>
  kind === "list" ? ((v as string[]) ?? []).join(", ") : v == null ? "" : String(v);
const initial = (v: unknown, kind: Kind) =>
  kind === "metric" ? String(v ?? "reply") : show(v, kind);
const split = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function OptionsTab({
  campaignId,
  campaign,
  members,
  canEdit,
  onChange,
}: {
  campaignId: string;
  campaign: CampaignView;
  members: { userId: string; name: string }[];
  canEdit: boolean;
  onChange: () => void;
}) {
  const [form, setForm] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      FIELDS.map((f) => [
        f.k,
        f.kind === "bool"
          ? Boolean(campaign[f.k])
          : f.k === "optOutText"
            ? String(campaign[f.k] ?? DEFAULT_OPT_OUT)
            : initial(campaign[f.k], f.kind),
      ]),
    ),
  );
  const [owner, setOwner] = useState((campaign.ownerId as string | null) ?? "");
  const [rules, setRules] = useState<Rule[]>((campaign.espRoutingRules as Rule[]) ?? []);
  const [msg, setMsg] = useState("");
  const set = (k: string, v: string | boolean) => setForm((o) => ({ ...o, [k]: v }));

  async function save() {
    const body: Record<string, unknown> = {
      espRoutingRules: rules,
      ownerId: owner || null,
      unsubscribeHeader: true,
    };
    for (const f of FIELDS) {
      const v = form[f.k];
      if (f.kind === "bool") body[f.k] = v;
      else if (f.kind === "list") body[f.k] = split(v as string);
      else if (f.kind === "int") {
        const t = (v as string).trim();
        body[f.k] = t === "" ? null : Number(t);
        // required numbers: an empty box keeps the stored value instead of sending null
        if (t === "" && (f.k === "minGapSec" || f.k === "randomGapSec")) delete body[f.k];
      } else body[f.k] = f.k === "name" ? v : (v as string).trim() || null;
    }
    const r = await call(`/api/v1/campaigns/${campaignId}`, "PATCH", body);
    setMsg(r.ok ? "Options saved." : errorText(r));
    if (r.ok) onChange();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
        {FIELDS.filter((f) => f.k !== "optOutText" || !form.unsubscribeLink).map((f) =>
          f.kind === "bool" ? (
            <label key={f.k} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form[f.k] as boolean}
                onChange={(e) => set(f.k, e.target.checked)}
              />
              {f.label}
            </label>
          ) : (
            <div key={f.k} className="flex flex-col gap-1">
              <label htmlFor={`opt-${f.k}`} className="text-sm font-medium">
                {f.label}
              </label>
              {f.kind === "metric" ? (
                <select
                  id={`opt-${f.k}`}
                  className={sel}
                  value={form[f.k] as string}
                  onChange={(e) => set(f.k, e.target.value)}
                  aria-describedby={`opt-${f.k}-hint`}
                >
                  {METRICS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`opt-${f.k}`}
                  type={f.kind === "int" ? "number" : "text"}
                  min={f.kind === "int" ? 0 : undefined}
                  step={f.k === "plValue" ? "any" : undefined}
                  value={form[f.k] as string}
                  onChange={(e) => set(f.k, e.target.value)}
                  aria-describedby={f.hint || f.k === "optOutText" ? `opt-${f.k}-hint` : undefined}
                />
              )}
              {f.k === "optOutText" && (
                <p id="opt-optOutText-hint" className="text-xs text-muted-foreground">
                  Replaces the link. Replies asking to unsubscribe are detected automatically and
                  the lead is suppressed.
                </p>
              )}
              {f.hint && (
                <p id={`opt-${f.k}-hint`} className="text-xs text-muted-foreground">
                  {f.hint}
                </p>
              )}
            </div>
          ),
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="opt-owner" className="text-sm font-medium">
            Owner
          </label>
          <select
            id="opt-owner"
            className={sel}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">No owner</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked disabled aria-describedby="unsub-why" />
            Unsubscribe header
          </label>
          <p id="unsub-why" className="text-xs text-muted-foreground">
            Always on: every campaign email carries a List-Unsubscribe header, and unsubscribes are
            always honored.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <h3 className="text-sm font-medium">Provider routing rules</h3>
          {rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              {(
                [
                  ["action", ["send", "do_not_send"], "Action"],
                  ["senderEsp", ESP, "Sender provider"],
                  ["recipientEsp", ESP, "Recipient provider"],
                ] as const
              ).map(([k, opts, label]) => (
                <select
                  key={k}
                  aria-label={`${label} of rule ${i + 1}`}
                  className={sel}
                  value={r[k]}
                  onChange={(e) =>
                    setRules((o) => o.map((x, n) => (n === i ? { ...x, [k]: e.target.value } : x)))
                  }
                >
                  {opts.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => setRules((o) => o.filter((_, n) => n !== i))}
              >
                Remove rule {i + 1}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              setRules((o) => [...o, { action: "send", recipientEsp: "all", senderEsp: "all" }])
            }
          >
            Add rule
          </Button>
        </div>
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit">Save options</Button>
          <p role="status" className="text-sm">
            {msg}
          </p>
        </div>
      )}
    </form>
  );
}
