"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call } from "../accounts/api-client";
import type { Member } from "../leads/bulk-bar";
import { ActivityList, useActivity } from "./activity-tab";
import { NotesSection, TasksSection } from "./deal-sections";
import {
  checkMoney,
  type Note,
  num,
  sel,
  type Task,
  useAttribution,
  useDialog,
} from "./drawer-kit";
import { friendly, type Opp, type StageOption } from "./types";

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
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const attribution = useAttribution(opp);
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
  useEffect(() => {
    void loadNotes();
    void loadTasks();
  }, []);

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

  async function log(kind: string, body: string) {
    const r = await call("/api/v1/inbox/notes", "POST", { leadId: opp.lead.id, kind, body });
    if (!r.ok) return (setError(friendly(r)), false);
    setError("");
    void loadNotes();
    void activity.reload();
    return true;
  }

  async function addTask(title: string, due: string) {
    const r = await call("/api/v1/crm/tasks", "POST", {
      title,
      opportunityId: opp.id,
      ...(due && { dueAt: new Date(due).toISOString() }),
    });
    if (!r.ok) return (setError(friendly(r)), false);
    setError("");
    void loadTasks();
    void activity.reload();
    return true;
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

      <NotesSection notes={notes} canEdit={canEdit} onLog={log} />

      <TasksSection
        tasks={tasks}
        canEdit={canEdit}
        opportunityId={opp.id}
        onAdd={addTask}
        onComplete={(t) => void complete(t)}
      />

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
