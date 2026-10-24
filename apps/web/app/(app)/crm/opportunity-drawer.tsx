"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call } from "../accounts/api-client";
import type { Member, Named } from "../leads/bulk-bar";
import { ActivityList, useActivity } from "./activity-tab";
import { friendly, type Opp, type StageOption } from "./types";

const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";
const MAX = 999_999_999_999.99;
const dialogCls =
  "m-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/40";

/** A modal <dialog> that reports its own close (Escape, Close button). */
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return {
    ref,
    props: { ref, onClose, className: dialogCls },
    close: () => ref.current?.close(),
  };
}

const num = (v: string) => String(Number(v));
/** "Value must be 0 or more" and friends; empty string means valid. */
const checkMoney = (label: string, v: string) =>
  v.trim() === "" || Number.isNaN(Number(v))
    ? `${label} must be a number`
    : Number(v) < 0
      ? `${label} must be 0 or more`
      : Number(v) > MAX
        ? `${label} is too large`
        : "";

type Note = { id: string; kind: string; body: string; createdAt: string };
type Task = { id: string; title: string; dueAt: string | null };
type Step = { id: string; order: number; variants: { id: string; label: string }[] };

export function OpportunityDrawer({
  opp: initial,
  stages,
  members,
  canEdit,
  onClose,
  onChanged,
}: {
  opp: Opp;
  stages: StageOption[];
  members: Member[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dlg = useDialog(onClose);
  const [opp, setOpp] = useState(initial);
  const toForm = (o: Opp) => ({
    title: o.title,
    stageId: o.stageId,
    value: num(o.value),
    cash: num(o.cashCollected),
    close: o.expectedCloseAt?.slice(0, 10) ?? "",
    ownerId: o.ownerId ?? "",
  });
  const [base, setBase] = useState(() => toForm(initial));
  const [form, setForm] = useState(base);
  const [errors, setErrors] = useState<{ value?: string; cash?: string }>({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [attribution, setAttribution] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteText, setNoteText] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const activity = useActivity(initial.id);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const loadNotes = async () =>
    setNotes(
      ((await call(`/api/v1/inbox/notes?leadId=${opp.lead.id}`, "GET")).json.notes ?? []) as Note[],
    );
  const loadTasks = async () =>
    setTasks(
      ((await call(`/api/v1/crm/tasks?opportunityId=${opp.id}`, "GET")).json.tasks ?? []) as Task[],
    );
  const [rec, setRec] = useState("");
  async function recommend() {
    setRec("");
    const r = await call("/api/v1/ai/recommend", "POST", { opportunityId: opp.id });
    setRec(
      r.ok
        ? `${(r.json as unknown as unknown[]).length} suggested task(s) wait for your approval under Tasks, Awaiting approval.`
        : r.status === 412
          ? "AI is not set up. An admin can add a model in Settings."
          : friendly(r),
    );
  }
  useEffect(() => {
    void loadNotes();
    void loadTasks();
  }, []);

  // "From {campaign} · step {n} · variant {label} · {account}"
  useEffect(() => {
    let live = true;
    void (async () => {
      const parts = [opp.campaign ? `From ${opp.campaign.name}` : "Created manually"];
      if (opp.campaign && opp.stepId) {
        const r = await call(`/api/v1/campaigns/${opp.campaign.id}/steps`, "GET");
        const subs = (r.json.subsequences ?? []) as { steps: Step[] }[];
        const all = [...((r.json.steps ?? []) as Step[]), ...subs.flatMap((s) => s.steps)];
        const step = all.find((s) => s.id === opp.stepId);
        if (step) parts.push(`step ${step.order}`);
        const v = step?.variants.find((x) => x.id === opp.variantId);
        if (v) parts.push(`variant ${v.label}`);
      }
      if (opp.accountId) {
        const r = await call(`/api/v1/accounts/${opp.accountId}`, "GET");
        if (typeof r.json.email === "string") parts.push(r.json.email);
      }
      if (live) setAttribution(parts.join(" · "));
    })();
    return () => {
      live = false;
    };
  }, [opp.campaign?.id, opp.stepId, opp.variantId, opp.accountId]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const bad = {
      value: checkMoney("Value", form.value),
      cash: checkMoney("Cash collected", form.cash),
    };
    setErrors({ value: bad.value || undefined, cash: bad.cash || undefined });
    if (bad.value || bad.cash) return setMsg("");
    const patch: Record<string, unknown> = {};
    if (form.title !== base.title) patch.title = form.title;
    if (form.stageId !== base.stageId) patch.stageId = form.stageId;
    if (form.value !== base.value) patch.value = Number(form.value);
    if (form.cash !== base.cash) patch.cashCollected = Number(form.cash);
    if (form.close !== base.close) patch.expectedCloseAt = form.close || null;
    if (form.ownerId !== base.ownerId) patch.ownerId = form.ownerId || null;
    if (!Object.keys(patch).length) return setMsg("Nothing changed.");
    const r = await call(`/api/v1/crm/opportunities/${opp.id}`, "PATCH", patch);
    if (!r.ok) {
      setMsg("");
      return setError(r.status === 404 ? "This deal or stage no longer exists." : friendly(r));
    }
    const next = r.json as unknown as Opp;
    setOpp(next);
    const f = toForm(next);
    setBase(f);
    setForm(f);
    setError("");
    setMsg("Saved.");
    void activity.reload();
    onChanged();
  }

  async function log(kind: string) {
    if (!noteText.trim()) return;
    const r = await call("/api/v1/inbox/notes", "POST", {
      leadId: opp.lead.id,
      kind,
      body: noteText.trim(),
    });
    if (!r.ok) return setError(friendly(r));
    setError("");
    setNoteText("");
    void loadNotes();
    void activity.reload();
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    const r = await call("/api/v1/crm/tasks", "POST", {
      title: taskTitle.trim(),
      opportunityId: opp.id,
      ...(taskDue && { dueAt: new Date(taskDue).toISOString() }),
    });
    if (!r.ok) return setError(friendly(r));
    setError("");
    setTaskTitle("");
    setTaskDue("");
    void loadTasks();
    void activity.reload();
  }

  async function complete(t: Task) {
    const r = await call(`/api/v1/crm/tasks/${t.id}`, "PATCH", { status: "DONE" });
    if (!r.ok) return setError(friendly(r));
    void loadTasks();
    void activity.reload();
  }

  const field = (id: string, label: string, error?: string, input?: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {input}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <dialog {...dlg.props} aria-labelledby="opp-title">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id="opp-title" className="text-lg font-semibold">
            {opp.title}
          </h2>
          <p className="text-sm text-muted-foreground">{opp.lead.email}</p>
          <p className="text-sm text-muted-foreground">{attribution}</p>
          {opp.closedAt && (
            <p className="text-sm">
              Closed on{" "}
              {new Date(opp.closedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={dlg.close}>
          Close
        </Button>
      </div>
      <form onSubmit={save} noValidate className="grid gap-3 sm:grid-cols-2">
        {field(
          "opp-title-in",
          "Title",
          undefined,
          <Input
            id="opp-title-in"
            disabled={!canEdit}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
          />,
        )}
        {field(
          "opp-stage",
          "Stage",
          undefined,
          <select
            id="opp-stage"
            disabled={!canEdit}
            className={sel}
            value={form.stageId}
            onChange={(e) => set("stageId", e.target.value)}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>,
        )}
        {field(
          "opp-value",
          "Value",
          errors.value,
          <Input
            id="opp-value"
            type="number"
            step="0.01"
            disabled={!canEdit}
            value={form.value}
            aria-invalid={!!errors.value}
            aria-describedby={errors.value ? "opp-value-err" : undefined}
            onChange={(e) => set("value", e.target.value)}
          />,
        )}
        {field(
          "opp-cash",
          "Cash collected",
          errors.cash,
          <Input
            id="opp-cash"
            type="number"
            step="0.01"
            disabled={!canEdit}
            value={form.cash}
            aria-invalid={!!errors.cash}
            aria-describedby={errors.cash ? "opp-cash-err" : undefined}
            onChange={(e) => set("cash", e.target.value)}
          />,
        )}
        {field(
          "opp-close",
          "Expected close",
          undefined,
          <Input
            id="opp-close"
            type="date"
            disabled={!canEdit}
            value={form.close}
            onChange={(e) => set("close", e.target.value)}
          />,
        )}
        {field(
          "opp-owner",
          "Owner",
          undefined,
          <select
            id="opp-owner"
            disabled={!canEdit}
            className={sel}
            value={form.ownerId}
            onChange={(e) => set("ownerId", e.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>,
        )}
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

      <section aria-label="Notes" className="mt-4 border-t border-border pt-4">
        <h3 className="mb-2 text-sm font-medium">Notes and calls</h3>
        <ul aria-label="Notes" className="mb-2 flex flex-col gap-1 text-sm">
          {notes.map((n) => (
            <li key={n.id}>
              <span className="text-muted-foreground">
                {new Date(n.createdAt).toLocaleString()}
              </span>{" "}
              {n.kind !== "note" && (
                <strong className="font-medium">{n.kind.toUpperCase()} </strong>
              )}
              {n.body}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="opp-note">Note or call summary</Label>
            <textarea
              id="opp-note"
              rows={2}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="rounded-md border border-border bg-card p-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void log("note")}>
                Add note
              </Button>
              <Button type="button" variant="outline" onClick={() => void log("call")}>
                Log call
              </Button>
              <Button type="button" variant="outline" onClick={() => void log("sms")}>
                Log SMS
              </Button>
              <Button type="button" variant="outline" onClick={() => void log("meeting")}>
                Log meeting
              </Button>
            </div>
          </div>
        )}
      </section>

      <section aria-label="Tasks" className="mt-4 border-t border-border pt-4">
        <h3 className="mb-2 text-sm font-medium">Tasks</h3>
        <ul aria-label="Tasks" className="mb-2 flex flex-col gap-1 text-sm">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <span>{t.title}</span>
              {t.dueAt && (
                <span className="text-muted-foreground">
                  due {new Date(t.dueAt).toLocaleString()}
                </span>
              )}
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  aria-label={`Complete ${t.title}`}
                  onClick={() => void complete(t)}
                >
                  Complete
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form onSubmit={addTask} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="task-title">Task title</Label>
              <Input
                id="task-title"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="task-due">Task due</Label>
              <Input
                id="task-due"
                type="datetime-local"
                value={taskDue}
                onChange={(e) => setTaskDue(e.target.value)}
              />
            </div>
            <Button type="submit">Add task</Button>
          </form>
        )}
        {canEdit && (
          <div className="mt-2 flex flex-col gap-1">
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => void recommend()}
            >
              Recommend next actions
            </Button>
            {rec && (
              <p role="status" className="text-sm">
                {rec}
              </p>
            )}
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Reminders are due dates only. Nothing is emailed or pushed.
        </p>
      </section>

      <section aria-label="Deal activity" className="mt-4 border-t border-border pt-4">
        <h3 className="mb-2 text-sm font-medium">Activity</h3>
        <ActivityList items={activity.items} members={members} />
        {activity.next && (
          <Button variant="outline" className="mt-2" onClick={() => void activity.more()}>
            Load more
          </Button>
        )}
      </section>
    </dialog>
  );
}

type Found = { id: string; email: string };

/** Create a deal for a lead found with `GET /api/v1/leads?q=`. */
export function NewOpportunity({
  stages,
  campaigns,
  onClose,
  onCreated,
}: {
  stages: StageOption[];
  campaigns: Named[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const dlg = useDialog(onClose);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [stageId, setStageId] = useState(stages.find((s) => s.kind === "OPEN")?.id ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!q.trim()) return setFound([]);
    let live = true;
    const t = setTimeout(async () => {
      const r = await call(`/api/v1/leads?${new URLSearchParams({ q: q.trim() })}`, "GET");
      if (live) setFound(((r.json.leads ?? []) as Found[]).slice(0, 50));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!leadId) return setError("Choose a lead first.");
    const bad = value.trim() ? checkMoney("Value", value) : "";
    if (bad) return setError(bad);
    const r = await call("/api/v1/crm/opportunities", "POST", {
      leadId,
      stageId,
      ...(title.trim() && { title: title.trim() }),
      ...(value.trim() && { value: Number(value) }),
      ...(campaignId && { campaignId }),
    });
    if (!r.ok) return setError(friendly(r));
    onCreated();
    dlg.close();
  }

  return (
    <dialog {...dlg.props} aria-labelledby="new-opp-title">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id="new-opp-title" className="text-lg font-semibold">
          New opportunity
        </h2>
        <Button variant="outline" onClick={dlg.close}>
          Close
        </Button>
      </div>
      <form onSubmit={create} noValidate className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-find">Find a lead</Label>
          <Input
            id="new-find"
            type="search"
            placeholder="Email, name or company"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-lead">Lead</Label>
          <select
            id="new-lead"
            className={sel}
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
          >
            <option value="">{found.length ? "Choose a lead" : "Search first"}</option>
            {found.map((l) => (
              <option key={l.id} value={l.id}>
                {l.email}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-title">Title</Label>
          <Input
            id="new-title"
            placeholder="Defaults to the company or email"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-value">Value</Label>
          <Input
            id="new-value"
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-stage">Stage</Label>
          <select
            id="new-stage"
            className={sel}
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-campaign">Campaign (optional)</Label>
          <select
            id="new-campaign"
            className={sel}
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">None</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit">Create opportunity</Button>
        </div>
      </form>
    </dialog>
  );
}
