"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Handshake,
  ListChecks,
  Reply,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { Callout } from "../../../components/callout";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";
import { call, errorText } from "../accounts/api-client";
import type { Member } from "../leads/bulk-bar";

export type Item = {
  id: string;
  at: string;
  kind: string;
  actorId: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
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

// B5.12 timeline discs: logged notes in chart-1, replies chart-2, stage moves neutral, tasks warning
const DISC: Record<string, { icon: LucideIcon; cls: string }> = {
  reply: { icon: Reply, cls: "bg-chart-2" },
  stage: { icon: ArrowRight, cls: "bg-neutral-solid" },
  task: { icon: ListChecks, cls: "bg-warning-solid" },
  opportunity: { icon: Handshake, cls: "bg-neutral-solid" },
};
const LOGGED_DISC = { icon: StickyNote, cls: "bg-chart-1" };

export function ActivityList({
  items,
  members,
  showDeal,
}: {
  items: Item[];
  members: Member[];
  /** names each item's deal (the workspace feed; a deal's own feed needs no name) */
  showDeal?: boolean;
}) {
  if (!items.length) return <p className="text-[13px]/[18px] text-fg-muted">No activity yet.</p>;
  return (
    <ul aria-label="Activity" className="flex flex-col">
      {items.map((i) => {
        const who = members.find((m) => m.userId === i.actorId)?.name ?? "Automatic";
        const deal = showDeal ? i.opportunityTitle : null;
        const disc = i.kind in LOGGED ? LOGGED_DISC : (DISC[i.kind] ?? DISC.opportunity!);
        return (
          <li
            key={i.id}
            className="relative flex gap-3 pb-4 text-[13px]/[18px] last:pb-0 [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:top-7 [&:not(:last-child)]:before:bottom-1 [&:not(:last-child)]:before:left-3 [&:not(:last-child)]:before:w-px [&:not(:last-child)]:before:bg-border"
          >
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", disc.cls)}>
              <disc.icon className="size-3 text-white dark:text-bg" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 pt-0.5">
              <strong className="font-medium">{who}</strong>{" "}
              {deal && <span className="text-fg-muted">{deal}: </span>}
              {what(i)}
            </span>
            <time dateTime={i.at} className="shrink-0 pt-0.5 text-fg-subtle tabular-nums">
              {new Date(i.at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
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
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}
      <Card className="max-w-3xl">
        <ActivityList items={items} members={members} showDeal />
      </Card>
      {next && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => void more()}>
          Load more
        </Button>
      )}
    </div>
  );
}
