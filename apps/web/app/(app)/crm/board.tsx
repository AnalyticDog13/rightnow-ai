"use client";

import { KanbanSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Callout } from "../../../components/callout";
import { EmptyState } from "../../../components/empty-state";
import { chipClass } from "../../../components/overlay";
import { pillFor, STAGE_KIND, StatusPill } from "../../../components/status-pill";
import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import { call, errorText } from "../accounts/api-client";
import type { Member, Named } from "../leads/bulk-bar";
import { NewOpportunity } from "./new-opportunity";
import { OpportunityDrawer } from "./opportunity-drawer";
import { money, type BoardData, type Opp } from "./types";

export function Board({
  initial,
  query,
  members,
  campaigns,
  canEdit,
  creating,
  onCreating,
}: {
  initial: BoardData | null;
  query: Record<string, string>;
  members: Member[];
  campaigns: Named[];
  canEdit: boolean;
  /** the "New opportunity" dialog is opened from the page header */
  creating: boolean;
  onCreating: (on: boolean) => void;
}) {
  const router = useRouter();
  const [board, setBoard] = useState(initial);
  const [error, setError] = useState("");
  const [announce, setAnnounce] = useState("");
  const [open, setOpen] = useState<Opp | null>(null);
  const [over, setOver] = useState<string | null>(null); // the column a card is dragged over

  const seq = useRef(0);
  // the select of the card that was just moved: it is re-mounted in its new column, so focus is put back on it
  const selects = useRef(new Map<string, HTMLSelectElement>());
  const refocus = useRef<string | null>(null);
  const qs = new URLSearchParams({ view: "board", ...query }).toString();

  // the newest request wins, so a slow answer never overwrites a fresher board
  const load = useCallback(async () => {
    const n = ++seq.current;
    const r = await call(`/api/v1/crm/opportunities?${qs}`, "GET");
    if (n !== seq.current) return;
    if (r.ok) setBoard(r.json as unknown as BoardData);
    else setError((e) => e || errorText(r)); // never replaces the error of the action that asked for this load
  }, [qs]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = refocus.current && selects.current.get(refocus.current);
    if (el && (!document.activeElement || document.activeElement === document.body)) el.focus();
  }, [board]);

  const changed = () => {
    void load();
    router.refresh();
  };

  // optimistic placement with a snapshot: a failed move puts the card back at once, then the board reloads
  async function move(o: Opp, stageId: string) {
    if (!canEdit || !board || o.stageId === stageId) return;
    const to = board.stages.find((s) => s.id === stageId);
    if (!to) return;
    const prev = board;
    refocus.current = o.id;
    setError("");
    seq.current++; // an older board still in flight must not overwrite the move
    setBoard({
      ...board,
      stages: board.stages.map((s) =>
        s.id === o.stageId
          ? {
              ...s,
              count: s.count - 1,
              opportunities: s.opportunities.filter((x) => x.id !== o.id),
            }
          : s.id === stageId
            ? { ...s, count: s.count + 1, opportunities: [{ ...o, stageId }, ...s.opportunities] }
            : s,
      ),
    });
    const r = await call(`/api/v1/crm/opportunities/${o.id}`, "PATCH", { stageId });
    if (r.ok) setAnnounce(`Moved ${o.title} to ${to.name}`);
    else {
      setBoard(prev);
      setError(
        r.status === 404
          ? `Could not move ${o.title}: it or the stage no longer exists. The card was put back.`
          : `Could not move ${o.title}: ${errorText(r)}. The card was put back.`,
      );
    }
    changed();
  }

  const find = (id: string) =>
    board?.stages.flatMap((s) => s.opportunities).find((o) => o.id === id);
  const memberName = Object.fromEntries(members.map((m) => [m.userId, m.name]));
  const filtered = Object.keys(query).length > 0;
  const empty = board && board.stages.every((s) => s.count === 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px]/[18px] text-fg-muted">
        Drag a card to another stage, or use the card&apos;s Stage menu.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {error && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}
      {empty && !filtered && (
        <EmptyState
          icon={KanbanSquare}
          title="No opportunities yet."
          body="Mark a reply as Interested in the inbox, or create one here."
        />
      )}
      {!board ? (
        <p className="text-[13px]/[18px] text-fg-muted">Loading…</p>
      ) : (
        <div
          tabIndex={0}
          role="group"
          aria-label="Pipeline board"
          className="relative -mx-4 flex snap-x snap-proximity scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-2 focus-visible:-outline-offset-2 md:mx-0 md:px-0"
        >
          {board.stages.map((s) => (
            <section
              key={s.id}
              aria-label={s.name}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setOver(s.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const o = find(e.dataTransfer.getData("text/plain"));
                if (o) void move(o, s.id);
              }}
              className={cn(
                "flex max-h-[calc(100dvh-220px)] w-[85vw] shrink-0 snap-start flex-col rounded-lg bg-sunken p-2 transition-colors duration-(--dur-1) md:w-72",
                over === s.id && "bg-signal-tint",
              )}
            >
              <header className="flex shrink-0 flex-col gap-0.5 px-1.5 pt-1 pb-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden className={cn("size-2 rounded-full", DOT[s.kind])} />
                  <h2 className="min-w-0 truncate text-sm font-semibold">{s.name}</h2>
                  <span
                    aria-hidden
                    className="ml-auto min-w-4.5 rounded-full bg-surface px-1.25 text-center font-mono text-[11px]/[18px] font-medium text-fg-muted tabular-nums"
                  >
                    {s.count}
                  </span>
                </span>
                <span className="text-[13px]/[18px] text-fg-muted tabular-nums">
                  {money(board.currency, s.value)} · {s.count} {s.count === 1 ? "deal" : "deals"}
                </span>
              </header>
              <ul className="flex min-h-12 flex-col gap-2 overflow-y-auto">
                {s.opportunities.map((o) => {
                  const owner = o.ownerId ? memberName[o.ownerId] : undefined;
                  return (
                    <li key={o.id}>
                      <div
                        className="flex cursor-grab flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2.5 text-sm active:cursor-grabbing"
                        draggable={canEdit}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", o.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <button
                          type="button"
                          aria-label={`Open ${o.title}`}
                          onClick={() => setOpen(o)}
                          className="min-w-0 self-start truncate rounded-xs text-left font-medium hover:underline focus-visible:outline-offset-1"
                        >
                          {o.title}
                        </button>
                        <span className="truncate text-[13px]/[18px] text-fg-muted">
                          {o.lead.companyName ? `${o.lead.companyName} · ` : ""}
                          {o.lead.email}
                        </span>
                        {o.campaign && (
                          <span className={cn(chipClass, "self-start")}>{o.campaign.name}</span>
                        )}
                        <span className="flex items-center gap-2 text-[13px]/[18px] tabular-nums">
                          {money(board.currency, o.value)}
                          {owner && (
                            <span
                              title={owner}
                              className="ml-auto grid size-5 place-items-center rounded-full bg-sunken font-mono text-[10px] font-medium text-fg-muted"
                            >
                              <span aria-hidden>{initials(owner)}</span>
                              <span className="sr-only">Owner {owner}</span>
                            </span>
                          )}
                        </span>
                        {s.kind !== "OPEN" && (
                          <StatusPill
                            {...pillFor(STAGE_KIND, KIND_LABEL[s.kind])}
                            size="sm"
                            className="self-start"
                          >
                            {KIND_LABEL[s.kind]}
                            {o.closedAt && ` · closed ${o.closedAt.slice(0, 10)}`}
                          </StatusPill>
                        )}
                        <Select
                          ref={(el: HTMLSelectElement | null) => {
                            if (el) selects.current.set(o.id, el);
                            else selects.current.delete(o.id);
                          }}
                          size="sm"
                          className="mt-1"
                          aria-label={`Stage of ${o.title}`}
                          disabled={!canEdit}
                          value={o.stageId}
                          onChange={(e) => void move(o, e.target.value)}
                        >
                          {board.stages.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </li>
                  );
                })}
                {s.opportunities.length === 0 && (
                  <li className="px-2 py-6 text-center text-[13px]/[18px] text-fg-subtle">
                    No deals in this stage
                  </li>
                )}
              </ul>
              {s.more && (
                <p className="px-1.5 pt-2 text-[13px]/[18px] text-fg-muted">
                  Showing the first {s.opportunities.length} of {s.count}. Filter to see the rest.
                </p>
              )}
            </section>
          ))}
        </div>
      )}
      {open && board && (
        <OpportunityDrawer
          key={open.id}
          opp={open}
          stages={board.stages}
          members={members}
          currency={board.currency}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onChanged={changed}
        />
      )}
      {creating && board && (
        <NewOpportunity
          stages={board.stages}
          campaigns={campaigns}
          onClose={() => onCreating(false)}
          onCreated={changed}
        />
      )}
    </div>
  );
}

const DOT = { OPEN: "bg-neutral-solid", WON: "bg-success-solid", LOST: "bg-danger-solid" } as const;
const KIND_LABEL = { OPEN: "Open", WON: "Won", LOST: "Lost" } as const;
const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
