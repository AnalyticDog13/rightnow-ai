"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
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

  const load = useCallback(async () => {
    const p = new URLSearchParams({ status });
    if (due) p.set("due", due);
    if (assigneeId) p.set("assigneeId", assigneeId);
    const r = await call(`/api/v1/crm/tasks?${p}`, "GET");
    if (!r.ok) return setError((e) => e || friendly(r));
    setTasks(r.json.tasks as Task[]);
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
      {tasks && !tasks.length && <p className="text-sm text-muted-foreground">No tasks match.</p>}
      <ul aria-label="Task list" className="flex flex-col gap-2">
        {tasks?.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm"
          >
            <span className="font-medium">{t.title}</span>
            {t.lead && <span className="text-muted-foreground">{t.lead.email}</span>}
            <span className="text-muted-foreground">
              {t.dueAt ? `due ${new Date(t.dueAt).toLocaleString()}` : "no due date"}
              {t.dueAt && t.status === "OPEN" && new Date(t.dueAt) < new Date() ? " (overdue)" : ""}
            </span>
            <span className="text-muted-foreground">{name(t.assigneeId)}</span>
            {canEdit && t.status === "OPEN" && (
              <Button
                variant="outline"
                className="ml-auto h-8 px-2 text-xs"
                aria-label={`Complete ${t.title}`}
                onClick={() => void setTo(t, "DONE")}
              >
                Complete
              </Button>
            )}
            {canEdit && t.status === "AWAITING_APPROVAL" && (
              <Button
                variant="outline"
                className="ml-auto h-8 px-2 text-xs"
                aria-label={`Approve ${t.title}`}
                onClick={() => void setTo(t, "OPEN")}
              >
                Approve
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
