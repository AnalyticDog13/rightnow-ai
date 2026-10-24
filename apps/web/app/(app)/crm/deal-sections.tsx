"use client";

import { useState, type FormEvent } from "react";
import { useAiOn } from "../../../components/ai-assist";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
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
    <section aria-label="Notes" className="mt-4 border-t border-border pt-4">
      <h3 className="mb-2 text-sm font-medium">Notes and calls</h3>
      <ul aria-label="Notes" className="mb-2 flex flex-col gap-1 text-sm">
        {notes.map((n) => (
          <li key={n.id}>
            <span className="text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>{" "}
            {n.kind !== "note" && <strong className="font-medium">{n.kind.toUpperCase()} </strong>}
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
      {canEdit && aiOn && (
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
  );
}
