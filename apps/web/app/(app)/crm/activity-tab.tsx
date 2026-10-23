"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { call, errorText } from "../accounts/api-client";
import type { Member } from "../leads/bulk-bar";

export type Item = {
  id: string;
  at: string;
  kind: string;
  actorId: string | null;
  opportunityId: string | null;
  detail: Record<string, unknown>;
};

const LOGGED: Record<string, string> = {
  note: "Note",
  call: "Call",
  sms: "SMS",
  meeting: "Meeting",
};
const str = (v: unknown) => (typeof v === "string" ? v : "");

function what(i: Item): string {
  const d = i.detail;
  if (i.kind in LOGGED) return `${LOGGED[i.kind]}: ${str(d.body)}`;
  if (i.kind === "reply") return "Reply received";
  if (i.kind === "stage") return `${str(d.from) || "?"} → ${str(d.to) || "?"}`;
  const act = str(d.action);
  if (i.kind === "task") {
    const t = str(d.title) || "a task";
    return act === "task.create"
      ? `Task added: ${t}`
      : act === "task.delete"
        ? "Task deleted"
        : d.status === "DONE"
          ? `Task completed: ${t}`
          : `Task updated: ${t}`;
  }
  return act === "opportunity.create"
    ? "Deal created"
    : act === "opportunity.delete"
      ? "Deal deleted"
      : "Deal updated";
}

export function ActivityList({
  items,
  members,
  titles,
}: {
  items: Item[];
  members: Member[];
  titles?: Map<string, string>;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ul aria-label="Activity" className="flex flex-col gap-2 text-sm">
      {items.map((i) => {
        const who = members.find((m) => m.userId === i.actorId)?.name ?? "Automatic";
        const deal = i.opportunityId && titles ? titles.get(i.opportunityId) : undefined;
        return (
          <li key={i.id}>
            <span className="text-muted-foreground">{new Date(i.at).toLocaleString()}</span>{" "}
            <strong className="font-medium">{who}</strong>{" "}
            {deal && <span className="text-muted-foreground">{deal}: </span>}
            {what(i)}
          </li>
        );
      })}
    </ul>
  );
}

/** Pages the activity feed (`crm/activity`) for a deal, or the whole workspace when no `opportunityId`. */
export function useActivity(opportunityId?: string) {
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const url = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams();
      if (opportunityId) p.set("opportunityId", opportunityId);
      if (cursor) p.set("cursor", cursor);
      return `/api/v1/crm/activity?${p}`;
    },
    [opportunityId],
  );
  const apply = (r: Awaited<ReturnType<typeof call>>, append: boolean) => {
    if (!r.ok) return setError(errorText(r));
    setError("");
    setItems((o) => (append ? [...o, ...(r.json.items as Item[])] : (r.json.items as Item[])));
    setNext((r.json.nextCursor as string | null) ?? null);
  };
  const reload = useCallback(async () => apply(await call(url(), "GET"), false), [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const more = async () => apply(await call(url(next!), "GET"), true);
  return { items, next, error, more, reload };
}

export function ActivityTab({ members }: { members: Member[] }) {
  const { items, next, error, more } = useActivity();
  const [titles, setTitles] = useState(new Map<string, string>());
  useEffect(() => {
    void call("/api/v1/crm/opportunities?take=200", "GET").then((r) =>
      setTitles(
        new Map(
          ((r.json.opportunities ?? []) as { id: string; title: string }[]).map((o) => [
            o.id,
            o.title,
          ]),
        ),
      ),
    );
  }, []);
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ActivityList items={items} members={members} titles={titles} />
      {next && (
        <Button variant="outline" className="self-start" onClick={() => void more()}>
          Load more
        </Button>
      )}
    </div>
  );
}
