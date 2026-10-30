"use client";

import { AlertCircle, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { sheetClass, sheetFooter, sheetHeader } from "../../../components/overlay";
import { pillFor, STAGE_KIND, StatusPill } from "../../../components/status-pill";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { DrawerSection } from "../accounts/account-drawer";
import { call } from "../accounts/api-client";
import type { Member } from "../leads/bulk-bar";
import { ActivityList, useActivity } from "./activity-tab";
import { NotesSection, TasksSection } from "./deal-sections";
import { checkMoney, type Note, num, type Task, useAttribution, useDialog } from "./drawer-kit";
import { friendly, money, type Opp, type StageOption } from "./types";

export function OpportunityDrawer({
  opp: initial,
  stages,
  members,
  currency,
  canEdit,
  onClose,
  onChanged,
}: {
  opp: Opp;
  stages: StageOption[];
  currency: string;
  members: Member[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dlg = useDialog(onClose, sheetClass());

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
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {input}
      {error && (
        <p
          id={`${id}-err`}
          role="alert"
          className="flex items-center gap-1 text-[13px]/[18px] text-danger"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
  const stage = stages.find((s) => s.id === opp.stageId);
  const kind = stage ? KIND_LABEL[stage.kind] : undefined;

  return (
    <dialog {...dlg.props} aria-labelledby="opp-title">
      <div className="flex h-full flex-col">
        <header className={sheetHeader}>
          <h2 id="opp-title" className="min-w-0 truncate text-base font-semibold" title={opp.title}>
            {opp.title}
          </h2>
          {stage && kind && (
            <StatusPill {...pillFor(STAGE_KIND, kind)} className="max-sm:hidden">
              {stage.name}
            </StatusPill>
          )}
          <Button variant="ghost" className="ml-auto" onClick={dlg.close}>
            <X aria-hidden />
            Close
          </Button>
        </header>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-5">
          <DrawerSection label="Deal" title="Details">
            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-sunken px-4 py-3">
              <div>
                <dt className="micro text-fg-muted">Value</dt>
                <dd className="text-xl/7 font-semibold tabular-nums">
                  {money(currency, opp.value)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="micro text-fg-muted">Lead</dt>
                <dd className="truncate text-sm font-medium" title={opp.lead.email}>
                  {opp.lead.email}
                </dd>
              </div>
            </dl>
            <p className="text-[13px]/[18px] text-fg-muted">{attribution}</p>
            {opp.closedAt && (
              <p className="text-[13px]/[18px]">
                Closed on{" "}
                {new Date(opp.closedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </p>
            )}
            <form
              id="opp-form"
              onSubmit={save}
              noValidate
              className="grid gap-x-4 gap-y-3 sm:grid-cols-2"
            >
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
                <Select
                  id="opp-stage"
                  disabled={!canEdit}
                  value={form.stageId}
                  onChange={(e) => set("stageId", e.target.value)}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>,
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
                <Select
                  id="opp-owner"
                  disabled={!canEdit}
                  value={form.ownerId}
                  onChange={(e) => set("ownerId", e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </Select>,
              )}
            </form>
          </DrawerSection>

          <NotesSection notes={notes} canEdit={canEdit} onLog={log} />

          <TasksSection
            tasks={tasks}
            canEdit={canEdit}
            opportunityId={opp.id}
            onAdd={addTask}
            onComplete={(t) => void complete(t)}
          />

          <DrawerSection label="Deal activity" title="Activity">
            <ActivityList items={activity.items} members={members} />
            {activity.next && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => void activity.more()}
              >
                Load more
              </Button>
            )}
          </DrawerSection>
        </div>
        {canEdit && (
          <footer className={sheetFooter}>
            <div className="mr-auto min-w-0 flex-1 text-[13px]/[18px]">
              {error && (
                <p role="alert" className="text-danger">
                  {error}
                </p>
              )}
              {msg && <p role="status">{msg}</p>}
            </div>
            <Button type="submit" form="opp-form">
              Save
            </Button>
          </footer>
        )}
      </div>
    </dialog>
  );
}

const KIND_LABEL = { OPEN: "Open", WON: "Won", LOST: "Lost" } as const;
