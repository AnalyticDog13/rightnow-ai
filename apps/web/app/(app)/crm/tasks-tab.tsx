"use client";

import { Check, Clock, ListChecks } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Callout } from "../../../components/callout";
import { pillFor, StatusPill, TASK_STATE } from "../../../components/status-pill";
import {
  BulkToolbar,
  Pager,
  SearchInput,
  SortTh,
  TableEmpty,
  TableFrame,
  usePage,
  useSelection,
  useSort,
} from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Helper } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { call } from "../accounts/api-client";
import type { Member } from "../leads/bulk-bar";
import { friendly } from "./types";

type Task = {
  id: string;
  title: string;
  dueAt: string | null;
  assigneeId: string | null;
  status: "OPEN" | "DONE" | "AWAITING_APPROVAL";
  lead: { id: string; email: string } | null;
};

export function TasksTab({ members, canEdit }: { members: Member[]; canEdit: boolean }) {
  const [status, setStatus] = useState("OPEN");
  const [due, setDue] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const pick = useSelection();

  const load = useCallback(async () => {
    const p = new URLSearchParams({ status });
    if (due) p.set("due", due);
    if (assigneeId) p.set("assigneeId", assigneeId);
    const r = await call(`/api/v1/crm/tasks?${p}`, "GET");
    if (!r.ok) return setError((e) => e || friendly(r));
    setTasks(r.json.tasks as Task[]);
    pick.clear();
  }, [status, due, assigneeId]);
  useEffect(() => {
    setError(""); // new filters, new list; a reload after an action keeps that action's error
    void load();
  }, [load]);

  // complete (OPEN -> DONE) and approve (AWAITING_APPROVAL -> OPEN)
  async function setTo(t: Task, to: "DONE" | "OPEN") {
    setError("");
    const r = await call(`/api/v1/crm/tasks/${t.id}`, "PATCH", { status: to });
    if (!r.ok) setError(friendly(r));
    void load();
  }

  const name = (id: string | null) => members.find((m) => m.userId === id)?.name ?? "Unassigned";
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tasks ?? []).filter(
      (t) =>
        !needle || [t.title, t.lead?.email ?? ""].some((v) => v.toLowerCase().includes(needle)),
    );
  }, [tasks, q]);
  const {
    sorted,
    sort,
    toggle: sortBy,
  } = useSort(shown, {
    title: (t) => t.title.toLowerCase(),
    lead: (t) => t.lead?.email.toLowerCase() ?? null,
    due: (t) => t.dueAt,
    assignee: (t) => name(t.assigneeId),
  });
  const pager = usePage(sorted);
  const ids = pager.rows.map((t) => t.id);
  const allOn = ids.length > 0 && ids.every((id) => pick.selected.has(id));

  // the single-task action for every chosen task of the filtered status
  async function bulk() {
    const to = status === "AWAITING_APPROVAL" ? "OPEN" : "DONE";
    setError("");
    const rs = await Promise.all(
      [...pick.selected].map((id) => call(`/api/v1/crm/tasks/${id}`, "PATCH", { status: to })),
    );
    const bad = rs.find((r) => !r.ok);
    if (bad) setError(friendly(bad));
    void load();
  }

  const now = new Date();
  const filtered = q.trim() !== "" || due !== "" || assigneeId !== "" || status !== "OPEN";
  return (
    <div className="flex flex-col gap-3">
      {canEdit && pick.selected.size > 0 && status !== "DONE" ? (
        <BulkToolbar count={pick.selected.size} onClear={pick.clear}>
          <Button variant="ghost" size="sm" onClick={() => void bulk()}>
            <Check aria-hidden />
            {status === "AWAITING_APPROVAL" ? "Approve selected" : "Complete selected"}
          </Button>
        </BulkToolbar>
      ) : (
        <div className="flex min-h-12 flex-wrap items-end gap-2">
          <SearchInput
            aria-label="Search tasks"
            placeholder="Search title or lead"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="task-status">Status</Label>
            <Select
              id="task-status"
              size="sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="OPEN">Open</option>
              <option value="DONE">Done</option>
              <option value="AWAITING_APPROVAL">Awaiting approval</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="task-due-filter">Due</Label>
            <Select
              id="task-due-filter"
              size="sm"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            >
              <option value="">Any time</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="upcoming">Upcoming</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="task-assignee">Assignee</Label>
            <Select
              id="task-assignee"
              size="sm"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <span className="ml-auto self-center text-[13px]/[18px] text-fg-muted tabular-nums">
            {shown.length} {shown.length === 1 ? "task" : "tasks"}
          </span>
        </div>
      )}
      <Helper>A reminder is a task&apos;s due date. Nothing is emailed or pushed.</Helper>
      {error && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}
      <TableFrame footer={<Pager page={pager.page} pages={pager.pages} onPage={pager.setPage} />}>
        <table aria-label="Tasks">
          <thead>
            <tr>
              <th scope="col" data-pin="check" className="w-11">
                <input
                  type="checkbox"
                  aria-label="Select all tasks"
                  checked={allOn}
                  disabled={!canEdit || ids.length === 0}
                  onChange={() => pick.setAll(ids, !allOn)}
                />
              </th>
              <SortTh col="title" sort={sort} onSort={sortBy} data-pin="id">
                Task
              </SortTh>
              <SortTh col="lead" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                Lead
              </SortTh>
              <SortTh col="due" sort={sort} onSort={sortBy}>
                Due
              </SortTh>
              <th scope="col">Status</th>
              <SortTh col="assignee" sort={sort} onSort={sortBy} className="hidden md:table-cell">
                Assignee
              </SortTh>
              <th scope="col" className="text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pager.rows.map((t) => {
              const overdue = !!t.dueAt && t.status === "OPEN" && new Date(t.dueAt) < now;
              const state = STATE_LABEL[t.status];
              return (
                <tr
                  key={t.id}
                  aria-selected={pick.selected.has(t.id)}
                  data-stripe={overdue ? "danger" : undefined}
                >
                  <td data-pin="check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${t.title}`}
                      checked={pick.selected.has(t.id)}
                      disabled={!canEdit}
                      onChange={() => pick.toggle(t.id)}
                    />
                  </td>
                  <td data-pin="id" className="max-w-64 truncate font-medium" title={t.title}>
                    {t.title}
                  </td>
                  <td className="hidden max-w-56 truncate text-fg-muted md:table-cell">
                    {t.lead?.email ?? <span className="text-fg-subtle">-</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {t.dueAt ? (
                      <StatusPill size="sm" icon={Clock} tone={overdue ? "danger" : "neutral"}>
                        {new Date(t.dueAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {overdue ? " (overdue)" : ""}
                      </StatusPill>
                    ) : (
                      <span className="text-[13px]/[18px] text-fg-subtle">No due date</span>
                    )}
                  </td>
                  <td>
                    <StatusPill {...pillFor(TASK_STATE, state)}>{state}</StatusPill>
                  </td>
                  <td className="hidden text-fg-muted md:table-cell">{name(t.assigneeId)}</td>
                  <td>
                    <div className="flex justify-end">
                      {canEdit && t.status === "OPEN" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Complete ${t.title}`}
                          onClick={() => void setTo(t, "DONE")}
                        >
                          <Check aria-hidden />
                          <span className="max-md:sr-only">Complete</span>
                        </Button>
                      )}
                      {canEdit && t.status === "AWAITING_APPROVAL" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Approve ${t.title}`}
                          onClick={() => void setTo(t, "OPEN")}
                        >
                          <Check aria-hidden />
                          <span className="max-md:sr-only">Approve</span>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {tasks && shown.length === 0 && (
              <TableEmpty
                colSpan={7}
                icon={ListChecks}
                title={filtered ? "No tasks match." : "No tasks."}
                body={filtered ? undefined : "Tasks you or your automations create appear here."}
              />
            )}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}

const STATE_LABEL = { OPEN: "Open", DONE: "Done", AWAITING_APPROVAL: "Awaiting approval" } as const;
