"use client";

import type { ApiLead } from "@rightnow/core";
import { useEffect, useRef, useState } from "react";
import { AiAssist } from "../../../components/ai-assist";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call, errorText } from "../accounts/api-client";
import { ESP, INTEREST, VERIFICATION } from "./labels";

const FIELDS = [
  ...[
    ["firstName", "First name"],
    ["lastName", "Last name"],
    ["companyName", "Company"],
  ],
  ...[
    ["jobTitle", "Job title"],
    ["website", "Website"],
    ["industry", "Industry"],
  ],
  ...[
    ["phone", "Phone"],
    ["country", "Country"],
  ],
] as const;
type TimelineItem = { at: string; kind: string; detail: Record<string, unknown> };
const describe = (t: TimelineItem) => {
  const d = t.detail;
  switch (t.kind) {
    case "imported":
      return `Imported from ${d.fileName}`;
    case "enrolled":
      return `Added to campaign ${d.campaign}`;
    case "sent":
      return `Step ${d.step}${d.variant ? ` (variant ${d.variant})` : ""} sent from ${d.account}`;
    case "status_changed":
      return `Interest status set to ${INTEREST[String(d.interestStatus)] ?? "Lead"}`;
    case "merged":
      return "Merged with a duplicate";
    case "unsubscribed":
      return "Unsubscribed";
    case "opened":
      return "Opened (estimated)";
    case "clicked":
      return `Clicked ${d.url ?? "a link"}`;
    case "replied":
      return d.auto ? "Auto-replied" : "Replied";
    case "bounced":
      return `Bounced (${String(d.type).toLowerCase()})`;
    case "note":
      return `Note (${d.noteKind}): ${d.body}`;
    case "task":
      if (d.action === "task.delete") return d.title ? `Task removed: ${d.title}` : "Task removed";
      return `Task ${d.action === "task.create" ? "added" : "updated"}: ${d.title ?? "(deleted)"}`;
    case "opportunity":
      return `Deal ${String(d.action).slice("opportunity.".length)}`;
    default:
      return `Suppressed (${String(d.reason).toLowerCase()})`;
  }
};
type Custom = { key: string; value: string }[];
const toCustom = (l: ApiLead): Custom =>
  Object.entries(l.customFields as Record<string, unknown>).map(([key, v]) => ({
    key,
    value: v === null ? "" : String(v),
  }));
const toForm = (l: ApiLead): Record<string, string> => ({
  ...Object.fromEntries(FIELDS.map(([k]) => [k, (l[k] as string | null) ?? ""])),
  tags: l.tags.join(", "),
  interest: l.interestStatus === null ? "" : String(l.interestStatus),
});

/** AI helpers (D47). A follow-up is copied to the clipboard once approved; sending stays a human step in the inbox. */
function LeadAi({ lead, onChanged }: { lead: ApiLead; onChanged: () => void }) {
  const [scored, setScored] = useState<{ aiScore: number; aiScoreReason: string } | null>(
    lead.aiScore === null
      ? null
      : { aiScore: lead.aiScore, aiScoreReason: lead.aiScoreReason ?? "" },
  );
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  async function rate() {
    setErr("");
    const r = await call("/api/v1/ai/score", "POST", { leadId: lead.id });
    if (!r.ok)
      return setErr(
        r.status === 412 ? "AI is not set up. An admin can add a model in Settings." : errorText(r),
      );
    setScored(r.json as { aiScore: number; aiScoreReason: string });
    onChanged();
  }
  return (
    <section aria-label="AI" className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-sm font-medium">AI</h3>
      <div className="flex flex-wrap items-start gap-2">
        <Button variant="outline" onClick={() => void rate()}>
          Score lead
        </Button>
        <AiAssist
          label="Suggest follow-up"
          path="followup"
          body={{ leadId: lead.id }}
          onUse={(t) => void navigator.clipboard?.writeText(t).then(() => setCopied(true))}
        />
      </div>
      {scored && (
        <p role="status" className="text-sm">
          Score {scored.aiScore}/100. {scored.aiScoreReason}
        </p>
      )}
      {copied && (
        <p role="status" className="text-sm">
          Follow-up copied. Paste it into a reply.
        </p>
      )}
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
    </section>
  );
}

export function LeadDrawer({
  lead,
  canEdit,
  onClose,
  onChanged,
}: {
  lead: ApiLead;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [init, setInit] = useState(() => toForm(lead));
  const [form, setForm] = useState(init);
  const [custom, setCustom] = useState<Custom>(() => toCustom(lead));
  const [initCustom, setInitCustom] = useState(custom);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);

  useEffect(() => {
    dialog.current?.showModal();
    void call(`/api/v1/leads/${lead.id}/timeline`, "GET").then((r) =>
      setTimeline((r.json.timeline as TimelineItem[] | undefined) ?? []),
    );
  }, [lead.id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    for (const [k] of FIELDS) if (form[k] !== init[k]) patch[k] = (form[k] ?? "").trim() || null;
    if (form.tags !== init.tags)
      patch.tags = (form.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    if (form.interest !== init.interest)
      patch.interestStatus = form.interest === "" ? null : Number(form.interest);
    if (JSON.stringify(custom) !== JSON.stringify(initCustom))
      patch.customFields = Object.fromEntries(
        custom.filter((c) => c.key.trim()).map((c) => [c.key.trim(), c.value]),
      );
    if (!Object.keys(patch).length) return setMsg("Nothing changed.");
    const r = await call(`/api/v1/leads/${lead.id}`, "PATCH", patch);
    if (!r.ok) {
      setMsg("");
      return setError(errorText(r));
    }
    setError("");
    setMsg("Saved.");
    setInit(form);
    setInitCustom(custom);
    onChanged();
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const stat = (label: string, v: string | number) => (
    <div key={label}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{v}</dd>
    </div>
  );

  return (
    <dialog
      ref={dialog}
      aria-labelledby="lead-title"
      onClose={onClose}
      className="m-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/40"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id="lead-title" className="text-lg font-semibold">
          {lead.email}
        </h2>
        <Button variant="outline" onClick={() => dialog.current?.close()}>
          Close
        </Button>
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {stat("Verification", VERIFICATION[lead.verificationStatus] ?? "")}
        {stat("ESP", ESP[lead.espType] ?? "")}
        {stat("Emails sent", lead.emailsSent)}
        {stat("Replies", lead.replies)}
      </dl>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label]) => (
          <div key={k} className="flex flex-col gap-1">
            <Label htmlFor={`lead-${k}`}>{label}</Label>
            <Input
              id={`lead-${k}`}
              disabled={!canEdit}
              value={form[k]}
              onChange={(e) => set(k, e.target.value)}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor="lead-interest">Interest status</Label>
          <select
            id="lead-interest"
            disabled={!canEdit}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm"
            value={form.interest}
            onChange={(e) => set("interest", e.target.value)}
          >
            <option value="">Lead (no status)</option>
            {Object.entries(INTEREST).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lead-tags">Tags (comma separated)</Label>
          <Input
            id="lead-tags"
            disabled={!canEdit}
            value={form.tags}
            onChange={(e) => set("tags", e.target.value)}
          />
        </div>
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="text-sm font-medium">Custom fields</legend>
          {custom.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label={`Custom field ${i + 1} name`}
                disabled={!canEdit}
                value={c.key}
                onChange={(e) =>
                  setCustom((o) => o.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                }
              />
              <Input
                aria-label={`Custom field ${i + 1} value`}
                disabled={!canEdit}
                value={c.value}
                onChange={(e) =>
                  setCustom((o) => o.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                }
              />
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Remove custom field ${i + 1}`}
                  onClick={() => setCustom((o) => o.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => setCustom((o) => [...o, { key: "", value: "" }])}
            >
              Add custom field
            </Button>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        )}
        {msg && (
          <p role="status" className="text-sm sm:col-span-2">
            {msg}
          </p>
        )}
        {canEdit && (
          <div className="sm:col-span-2">
            <Button type="submit">Save</Button>
          </div>
        )}
      </form>
      {canEdit && <LeadAi lead={lead} onChanged={onChanged} />}
      <section aria-label="Timeline" className="mt-4 border-t border-border pt-4">
        <h3 className="mb-2 text-sm font-medium">Timeline</h3>
        {timeline.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {timeline.map((t, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{new Date(t.at).toLocaleString()}</span>{" "}
                {describe(t)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        )}
      </section>
    </dialog>
  );
}
