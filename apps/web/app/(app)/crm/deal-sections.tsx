"use client";

import { Clock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAiOn } from "../../../components/ai-assist";
import { StatusPill } from "../../../components/status-pill";
import { Button } from "../../../components/ui/button";
import { Helper, Input, Textarea } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { DrawerSection } from "../accounts/account-drawer";
import { call } from "../accounts/api-client";
import type { Note, Task } from "./drawer-kit";
import { friendly } from "./types";

export function NotesSection({
  notes,
  canEdit,
  onLog,
}: {
  notes: Note[];
  canEdit: boolean;
  onLog: (kind: string, text: string) => Promise<boolean>;
}) {
  const [noteText, setNoteText] = useState("");
  const log = async (kind: string) => {
    if (!noteText.trim()) return;
    if (await onLog(kind, noteText.trim())) setNoteText("");
  };
  return (
    <DrawerSection label="Notes" title="Notes and calls">
      <ul aria-label="Notes" className="flex flex-col gap-1.5 empty:hidden">
        {notes.map((n) => (
          <li
            key={n.id}
            className="rounded-md border border-border bg-sunken px-3 py-2 text-[13px]/[18px]"
          >
            <span className="mb-0.5 flex items-center gap-2 text-fg-subtle tabular-nums">
              {n.kind !== "note" && <span className="micro text-fg-muted">{n.kind} </span>}
              {new Date(n.createdAt).toLocaleString()}
            </span>
            {n.body}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opp-note">Note or call summary</Label>
          <Textarea
            id="opp-note"
            rows={2}
            className="min-h-16"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <div className="mt-1 flex flex-wrap gap-1">
            <Button type="button" variant="outline" size="sm" onClick={() => void log("note")}>
              Add note
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void log("call")}>
              Log call
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void log("sms")}>
              Log SMS
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void log("meeting")}>
              Log meeting
            </Button>
          </div>
        </div>
      )}
    </DrawerSection>
  );
}

export function TasksSection({
  tasks,
  canEdit,
  opportunityId,
  onAdd,
  onComplete,
}: {
  tasks: Task[];
  canEdit: boolean;
  opportunityId: string;
  onAdd: (title: string, due: string) => Promise<boolean>;
  onComplete: (t: Task) => void;
}) {
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [rec, setRec] = useState("");
  const aiOn = useAiOn();
  async function addTask(e: FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    if (await onAdd(taskTitle.trim(), taskDue)) {
      setTaskTitle("");
      setTaskDue("");
    }
  }
  async function recommend() {
    setRec("");
    const r = await call("/api/v1/ai/recommend", "POST", { opportunityId: opportunityId });
    setRec(
      r.ok
        ? `${(r.json as unknown as unknown[]).length} suggested task(s) wait for your approval under Tasks, Awaiting approval.`
        : r.status === 412
          ? "AI is not set up. An admin can add a model in Settings."
          : friendly(r),
    );
  }
  return (
    <DrawerSection label="Tasks" title="Tasks">
      <ul aria-label="Tasks" className="flex flex-col divide-y divide-border empty:hidden">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="font-medium">{t.title}</span>
            {t.dueAt && (
              <StatusPill
                size="sm"
                icon={Clock}
                tone={new Date(t.dueAt) < new Date() ? "danger" : "neutral"}
              >
                due {new Date(t.dueAt).toLocaleString()}
              </StatusPill>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                aria-label={`Complete ${t.title}`}
                onClick={() => onComplete(t)}
              >
                Complete
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={addTask} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
            <Label htmlFor="task-title">Task title</Label>
            <Input
              id="task-title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-due">Task due</Label>
            <Input
              id="task-due"
              type="datetime-local"
              value={taskDue}
              onChange={(e) => setTaskDue(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            Add task
          </Button>
        </form>
      )}
      {canEdit && aiOn && (
        <div className="mt-2 flex flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => void recommend()}
          >
            Recommend next actions
          </Button>
          {rec && (
            <p role="status" className="text-[13px]/[18px]">
              {rec}
            </p>
          )}
        </div>
      )}
      <Helper>Reminders are due dates only. Nothing is emailed or pushed.</Helper>
    </DrawerSection>
  );
}
