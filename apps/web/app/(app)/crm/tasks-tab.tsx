"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BulkToolbar,
  Pager,
  SortTh,
  usePage,
  useSelection,
  useSort,
} from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Card } from "../../../components/ui/card";
import { Label } from "../../../components/ui/label";
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
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="task-status">Status</Label>
          <select
            id="task-status"
            className={sel}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="OPEN">Open</option>
            <option value="DONE">Done</option>
            <option value="AWAITING_APPROVAL">Awaiting approval</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="task-due-filter">Due</Label>
          <select
            id="task-due-filter"
            className={sel}
            value={due}
            onChange={(e) => setDue(e.target.value)}
          >
            <option value="">Any time</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="task-assignee">Assignee</Label>
          <select
            id="task-assignee"
            className={sel}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A reminder is a task&apos;s due date. Nothing is emailed or pushed.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Input
        type="search"
        aria-label="Search tasks"
        placeholder="Search title or lead"
        className="max-w-xs"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {canEdit && pick.selected.size > 0 && status !== "DONE" && (
        <BulkToolbar count={pick.selected.size}>
          <Button variant="outline" onClick={() => void bulk()}>
            {status === "AWAITING_APPROVAL" ? "Approve selected" : "Complete selected"}
          </Button>
        </BulkToolbar>
      )}
      <Card className="overflow-x-auto p-0">
        <table aria-label="Tasks" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="w-10 p-3">
                <input
                  type="checkbox"
                  aria-label="Select all tasks"
                  checked={allOn}
                  disabled={!canEdit || ids.length === 0}
                  onChange={() => pick.setAll(ids, !allOn)}
                />
              </th>
              <SortTh col="title" sort={sort} onSort={sortBy}>
                Task
              </SortTh>
              <SortTh col="lead" sort={sort} onSort={sortBy}>
                Lead
              </SortTh>
              <SortTh col="due" sort={sort} onSort={sortBy}>
                Due
              </SortTh>
              <SortTh col="assignee" sort={sort} onSort={sortBy}>
                Assignee
              </SortTh>
              <th scope="col" className="p-3 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pager.rows.map((t) => (
              <tr key={t.id} className="border-b border-border">
                <td className="p-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.title}`}
                    checked={pick.selected.has(t.id)}
                    disabled={!canEdit}
                    onChange={() => pick.toggle(t.id)}
                  />
                </td>
                <td className="p-3 font-medium">{t.title}</td>
                <td className="p-3 text-muted-foreground">{t.lead?.email}</td>
                <td className="p-3 text-muted-foreground">
                  {t.dueAt ? new Date(t.dueAt).toLocaleString() : "No due date"}
                  {t.dueAt && t.status === "OPEN" && new Date(t.dueAt) < new Date()
                    ? " (overdue)"
                    : ""}
                </td>
                <td className="p-3 text-muted-foreground">{name(t.assigneeId)}</td>
                <td className="p-3">
                  {canEdit && t.status === "OPEN" && (
                    <Button
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      aria-label={`Complete ${t.title}`}
                      onClick={() => void setTo(t, "DONE")}
                    >
                      Complete
                    </Button>
                  )}
                  {canEdit && t.status === "AWAITING_APPROVAL" && (
                    <Button
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      aria-label={`Approve ${t.title}`}
                      onClick={() => void setTo(t, "OPEN")}
                    >
                      Approve
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {tasks && shown.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  No tasks match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <Pager page={pager.page} pages={pager.pages} onPage={pager.setPage} />
    </div>
  );
}
