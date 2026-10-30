"use client";

import type { ApiAccount } from "@rightnow/core";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HealthRing } from "../../../components/health-ring";
import { pillFor, StatusPill, SYNC } from "../../../components/status-pill";
import { Button } from "../../../components/ui/button";
import { Helper, Input, Textarea } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Switch } from "../../../components/ui/switch";
import { AccountPill } from "./account-status";
import { call, errorText } from "./api-client";
import { ConnectMenu, NotConfigured, type Provider } from "./connect-menu";
import { ConnectSmtp } from "./connect-smtp";
import { DomainSection } from "./domain-section";
import { isNumeric } from "./numeric";
import { pushLine } from "./push-line";
import { RewarmSection } from "./rewarm-section";
import { WarmupSection } from "./warmup-section";

type Kind = "text" | "number" | "minutes" | "nullable";
// Gaps are stored in seconds and shown in minutes (PS-ACC-13).
const FIELDS: { k: keyof ApiAccount; label: string; kind: Kind }[] = [
  { k: "fromName", label: "From name", kind: "text" },
  { k: "firstName", label: "First name", kind: "text" },
  { k: "lastName", label: "Last name", kind: "text" },
  { k: "replyTo", label: "Reply-to address", kind: "nullable" },
  { k: "timezone", label: "Timezone", kind: "text" },
  { k: "dailyLimit", label: "Daily limit", kind: "number" },
  { k: "providerCap", label: "Provider daily cap", kind: "number" },
  { k: "minGapSec", label: "Minimum gap (minutes)", kind: "minutes" },
  { k: "randomGapSec", label: "Random extra gap (minutes)", kind: "minutes" },
  { k: "historyImportDays", label: "History import (days)", kind: "number" },
  { k: "rampStartVolume", label: "Ramp start volume", kind: "number" },
  { k: "rampIncrementPerDay", label: "Ramp increase per day", kind: "number" },
  { k: "trackingDomain", label: "Tracking domain", kind: "nullable" },
];
const BOOLS: { k: keyof ApiAccount; label: string }[] = [
  { k: "slowRamp", label: "Slow ramp-up" },
  { k: "appendToSent", label: "Save sent mail in the Sent folder" },
  { k: "placementSeed", label: "Use as an inbox placement seed" },
];
const REASON: Record<string, string> = {
  provider_cap: "half of the provider's daily cap",
  tier_max: "the highest cap this account type allows",
  provider_min_gap: "the provider's minimum gap",
};
const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.k, f.label]));
// recommended values from the deliverability guidance (30 campaign emails per account per day)
const HELP: Partial<Record<keyof ApiAccount, string>> = { dailyLimit: "Recommended 30 per day" };
const JUMP = [
  ["acc-settings", "Settings"],
  ["acc-sync", "Sync"],
  ["acc-domain", "Domain"],
  ["acc-warmup", "Warm-up"],
  ["acc-rewarm", "Re-warm"],
] as const;

const show = (a: ApiAccount, f: (typeof FIELDS)[number]) => {
  const v = a[f.k] as string | number | null;
  return v === null ? "" : f.kind === "minutes" ? String((v as number) / 60) : String(v);
};
const toForm = (a: ApiAccount) => ({
  ...Object.fromEntries(FIELDS.map((f) => [f.k, show(a, f)])),
  signature: a.signature ?? "",
  tags: a.tags.join(", "),
  slowRamp: a.slowRamp,
  appendToSent: a.appendToSent,
  placementSeed: a.placementSeed,
});
type Form = ReturnType<typeof toForm>;

/** B4.8 drawer section: a hairline above, an h3 title, a jump-bar target. */
export function DrawerSection({
  id,
  label,
  title,
  children,
}: {
  id?: string;
  label: string;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className="flex scroll-mt-4 flex-col gap-3 border-t border-border pt-6 text-sm first:border-t-0 first:pt-0"
    >
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {children}
    </section>
  );
}

/**
 * B4.8 / B5.3 account drawer: a native modal <dialog> shown as a 640px right sheet (full screen below 768), with a
 * sticky header, a jump bar to every section (all sections stay rendered) and a sticky footer holding Save.
 */
export function AccountDrawer({
  account,
  canEdit,
  isAdmin,
  configured,
  staleAfterSec,
  onClose,
  onChanged,
}: {
  account: ApiAccount;
  canEdit: boolean;
  isAdmin: boolean;
  configured: Record<Provider, boolean>;
  /** SYNC_MAX_STALENESS_SEC: a mailbox not synced within it does not send. */
  staleAfterSec: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [init, setInit] = useState<Form>(() => toForm(account));
  const [form, setForm] = useState<Form>(init);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testOk, setTestOk] = useState(false);
  const [sending, setSending] = useState(false);
  const [editCreds, setEditCreds] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [checks, setChecks] = useState<{ name: string; ok: boolean; code?: string }[]>([]);

  useEffect(() => {
    dialog.current?.showModal(); // Escape closes it natively and fires `close`
  }, []);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const v = form[f.k as keyof Form] as string;
      if (v === init[f.k as keyof Form]) continue;
      if ((f.kind === "number" || f.kind === "minutes") && !isNumeric(v))
        return setError(`${f.label}: enter a number.`);
      patch[f.k] =
        f.kind === "nullable"
          ? v.trim() === ""
            ? null
            : v.trim()
          : f.kind === "text"
            ? v
            : f.kind === "minutes"
              ? Math.round(Number(v) * 60)
              : Number(v);
    }
    if (form.signature !== init.signature)
      patch.signature = form.signature === "" ? null : form.signature;
    if (form.tags !== init.tags)
      patch.tags = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    for (const b of BOOLS)
      if (form[b.k as "slowRamp"] !== init[b.k as "slowRamp"]) patch[b.k] = form[b.k as "slowRamp"];
    if (Object.keys(patch).length === 0) return setNotes(["Nothing changed."]);
    const r = await call(`/api/v1/accounts/${account.id}`, "PATCH", patch);
    if (!r.ok) {
      setError(errorText(r));
      return setNotes([]);
    }
    setError("");
    const saved = r.json.account as ApiAccount;
    const next = toForm(saved);
    setInit(next);
    setForm(next);
    const warnings = r.json.warnings as { field: string; clampedTo: number; reason: string }[];
    setNotes(
      warnings.length
        ? warnings.map(
            (w) =>
              `${FIELD_LABEL[w.field] ?? w.field} was set to ${w.field === "minGapSec" ? `${w.clampedTo / 60} min` : w.clampedTo}, ${REASON[w.reason] ?? w.reason}.`,
          )
        : ["Saved."],
    );
    onChanged();
  }

  async function diagnose() {
    const r = await call(`/api/v1/accounts/${account.id}/diagnostics`, "POST", {});
    setChecks((r.json.checks as typeof checks) ?? []);
    setError(r.ok ? "" : errorText(r));
    onChanged();
  }
  async function markFixed() {
    const r = await call(`/api/v1/accounts/${account.id}/mark-fixed`, "POST", {});
    setChecks((r.json.checks as typeof checks) ?? []);
    setError(r.ok ? "" : errorText(r));
    onChanged();
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setTestMsg("Sending...");
    const r = await call(`/api/v1/accounts/${account.id}/test-send`, "POST", {
      to: testTo,
      confirmAuthorized: testOk,
    }).finally(() => setSending(false));
    setTestMsg(r.ok ? "Test email sent." : errorText(r));
    if (r.ok) onChanged();
  }

  const broken = account.status !== "CONNECTED" || account.lifecycle === "NEEDS_ATTENTION";
  const oauth: Provider = account.provider === "GMAIL" ? "google" : "microsoft";
  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault(); // scroll the drawer body; no hash in the URL
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="drawer-title"
      onClose={onClose}
      className="m-0 ml-auto h-dvh max-h-dvh w-screen max-w-none overflow-hidden border-border bg-surface text-fg shadow-e3 open:animate-sheet-right md:w-[min(640px,100vw)] md:border-l"
    >
      <div className="flex h-full flex-col">
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border py-2 pr-2 pl-5 md:pr-5">
          <h2
            id="drawer-title"
            className="min-w-0 truncate text-base font-semibold"
            title={account.email}
          >
            {account.email}
          </h2>
          <AccountPill account={account} />
          <HealthRing score={account.health.score} size={24} className="max-sm:hidden" />
          <Button variant="ghost" className="ml-auto" onClick={() => dialog.current?.close()}>
            <X aria-hidden />
            Close
          </Button>
        </header>
        <nav
          aria-label="Drawer sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-1.5 [scrollbar-width:none]"
        >
          {JUMP.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={jump(id)}
              className="inline-flex h-8 shrink-0 items-center rounded-sm px-2.5 text-[13px]/[18px] font-medium text-fg-muted hover:bg-hover hover:text-fg max-md:h-11"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-5">
          <DrawerSection id="acc-settings" label="Settings" title="Settings">
            <form
              id="account-settings"
              onSubmit={save}
              className="grid gap-x-4 gap-y-3 sm:grid-cols-2"
            >
              {FIELDS.map((f) => (
                <div key={f.k} className="flex flex-col gap-1.5">
                  <Label htmlFor={`f-${f.k}`}>{f.label}</Label>
                  <Input
                    id={`f-${f.k}`}
                    type={f.kind === "number" || f.kind === "minutes" ? "number" : "text"}
                    step={f.kind === "minutes" ? "any" : undefined}
                    min={f.kind === "number" || f.kind === "minutes" ? 0 : undefined}
                    disabled={!canEdit}
                    aria-describedby={HELP[f.k] ? `h-${f.k}` : undefined}
                    value={form[f.k as keyof Form] as string}
                    onChange={(e) => set(f.k, e.target.value)}
                  />
                  {HELP[f.k] && <Helper id={`h-${f.k}`}>{HELP[f.k]}</Helper>}
                </div>
              ))}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="f-tags">Tags (comma separated)</Label>
                <Input
                  id="f-tags"
                  disabled={!canEdit}
                  value={form.tags}
                  onChange={(e) => set("tags", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="f-signature">Signature</Label>
                <Textarea
                  id="f-signature"
                  rows={4}
                  disabled={!canEdit}
                  value={form.signature}
                  onChange={(e) => set("signature", e.target.value)}
                />
              </div>
              <div className="flex flex-col sm:col-span-2">
                {BOOLS.map((b) => (
                  <Switch
                    key={b.k}
                    label={b.label}
                    disabled={!canEdit}
                    checked={form[b.k as "slowRamp"]}
                    onChange={(e) => set(b.k, e.target.checked)}
                  />
                ))}
              </div>
            </form>
            <p role="alert" className="text-[13px]/[18px] text-danger empty:hidden">
              {error}
            </p>
          </DrawerSection>
          <SyncStatus sync={account.sync} push={account.push} staleAfterSec={staleAfterSec} />
          <DrawerSection id="acc-domain" label="Domain">
            <DomainSection email={account.email} canEdit={canEdit} />
          </DrawerSection>
          <DrawerSection id="acc-warmup" label="Warm-up">
            <WarmupSection accountId={account.id} canEdit={canEdit} />
          </DrawerSection>
          <DrawerSection id="acc-rewarm" label="Re-warm">
            <RewarmSection account={account} canEdit={canEdit} onChanged={onChanged} />
          </DrawerSection>
          {canEdit && (
            <DrawerSection label="Connection" title="Connection">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={diagnose}>
                  Run diagnostics
                </Button>
                {broken && (
                  <Button variant="outline" onClick={markFixed}>
                    Mark as fixed
                  </Button>
                )}
              </div>
              {checks.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {checks.map((c) => (
                    <li key={c.name} className="flex items-center gap-2">
                      <StatusPill tone={c.ok ? "success" : "danger"} size="sm">
                        {c.ok ? "ok" : "failed"}
                      </StatusPill>
                      {c.name}
                      {!c.ok && c.code ? ` (${c.code})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && (
                <form
                  onSubmit={sendTest}
                  aria-label="Send test email"
                  className="flex flex-col gap-3 rounded-lg border border-border p-4"
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="test-to">Send test email to</Label>
                    <Input
                      id="test-to"
                      type="email"
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                    />
                  </div>
                  <label className="flex min-h-11 items-center gap-2 md:min-h-0">
                    <input
                      type="checkbox"
                      checked={testOk}
                      onChange={(e) => setTestOk(e.target.checked)}
                    />
                    I am authorized to send from this account
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={!testOk || !testTo.trim() || sending}
                    >
                      Send test email
                    </Button>
                    <p aria-live="polite" className="text-[13px]/[18px]">
                      {testMsg}
                    </p>
                  </div>
                </form>
              )}
              {isAdmin &&
                account.provider === "SMTP" &&
                (editCreds ? (
                  <ConnectSmtp
                    reconnect={{ id: account.id, email: account.email }}
                    onDone={() => {
                      setEditCreds(false);
                      onChanged();
                    }}
                  />
                ) : (
                  <div>
                    <Button variant="outline" onClick={() => setEditCreds(true)}>
                      Reconnect with new credentials
                    </Button>
                  </div>
                ))}
              {isAdmin && account.provider !== "SMTP" && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <ConnectMenu
                      configured={configured}
                      reconnect={{ id: account.id, provider: oauth }}
                    />
                  </div>
                  <NotConfigured providers={configured[oauth] ? [] : [oauth]} />
                </>
              )}
            </DrawerSection>
          )}
        </div>
        {canEdit && (
          <footer className="flex min-h-16 shrink-0 items-center gap-3 border-t border-border px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <p role="status" className="min-w-0 flex-1 text-[13px]/[18px]">
              {notes.join(" ")}
            </p>
            <Button type="submit" form="account-settings">
              Save
            </Button>
          </footer>
        )}
      </div>
    </dialog>
  );
}

const SYNC_STATE = { IDLE: "Up to date", SYNCING: "Syncing", FAILED: "Last sync failed" } as const;

/** The B4.4 sync pill, or null for a mailbox synced within the freshness gate ("Synced 3 min ago"). */
export function syncPill(sync: ApiAccount["sync"], staleAfterSec: number) {
  if (sync.state === "SYNCING") return "Syncing";
  if (sync.state === "FAILED") return "Sync failing";
  if (sync.lagSec === null || sync.lagSec > staleAfterSec) return "Waiting for sync";
  return null;
}
const ago = (sec: number) => (sec < 60 ? "just now" : `${Math.round(sec / 60)} min ago`);

/** PS-ACC-31: sync state, lag and import progress. A mailbox that has not synced recently does not send. */
function SyncStatus({
  sync,
  push,
  staleAfterSec,
}: {
  sync: ApiAccount["sync"];
  push: ApiAccount["push"];
  staleAfterSec: number;
}) {
  const err = sync.lastError as { code?: string } | null;
  const pill = syncPill(sync, staleAfterSec);
  return (
    <DrawerSection id="acc-sync" label="Sync" title="Sync">
      <p>
        {pill ? (
          <StatusPill {...pillFor(SYNC, pill)}>{pill}</StatusPill>
        ) : (
          <span className="text-fg-subtle">Synced {ago(sync.lagSec ?? 0)}</span>
        )}
      </p>
      <p className="text-fg-muted">
        {SYNC_STATE[sync.state]}
        {sync.lastCompletedAt
          ? ` · last completed ${new Date(sync.lastCompletedAt).toLocaleString()} (${sync.lagSec} s ago)`
          : " · never completed: campaigns do not send from this account yet"}
      </p>
      {push && <p className="text-fg-muted">{pushLine(push)}</p>}
      {sync.progress && (
        <p>
          {sync.progress.mode === "HISTORICAL" ? "Importing history" : "Full re-sync"} since{" "}
          {new Date(sync.progress.since).toLocaleDateString()}: {sync.progress.fetched} messages (
          {sync.progress.folder === "INBOX" ? "Inbox" : "Sent"})
        </p>
      )}
      {sync.errors > 0 && (
        <p className="text-danger">
          {sync.errors} failed sync{sync.errors === 1 ? "" : "s"} in a row
          {err?.code ? ` (${err.code})` : ""}
        </p>
      )}
    </DrawerSection>
  );
}
