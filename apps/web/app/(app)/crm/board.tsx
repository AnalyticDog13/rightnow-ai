"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { call, errorText } from "../accounts/api-client";
import type { Member, Named } from "../leads/bulk-bar";
import { NewOpportunity, OpportunityDrawer } from "./opportunity-drawer";
import { money, type BoardData, type Opp } from "./types";

export function Board({
  initial,
  query,
  members,
  campaigns,
  canEdit,
}: {
  initial: BoardData | null;
  query: Record<string, string>;
  members: Member[];
  campaigns: Named[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [board, setBoard] = useState(initial);
  const [error, setError] = useState("");
  const [announce, setAnnounce] = useState("");
  const [open, setOpen] = useState<Opp | null>(null);
  const [creating, setCreating] = useState(false);
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Drag a card to another stage, or use the card&apos;s Stage menu.
        </p>
        {canEdit && <Button onClick={() => setCreating(true)}>New opportunity</Button>}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!board ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div
          tabIndex={0}
          role="group"
          aria-label="Pipeline board"
          className="flex items-start gap-3 overflow-x-auto pb-2"
        >
          {board.stages.map((s) => (
            <section
              key={s.id}
              aria-label={s.name}
              onDragOver={(e) => canEdit && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const o = find(e.dataTransfer.getData("text/plain"));
                if (o) void move(o, s.id);
              }}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3"
            >
              <header className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">{s.name}</h2>
                <span className="text-xs text-muted-foreground">
                  {s.count} · {money(board.currency, s.value)}
                </span>
              </header>
              <ul className="flex min-h-12 flex-col gap-2">
                {s.opportunities.map((o) => (
                  <li key={o.id}>
                    <Card
                      className="flex flex-col gap-1 p-3 text-sm"
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
                        className="self-start text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {o.title}
                      </button>
                      <span className="text-xs text-muted-foreground">{o.lead.email}</span>
                      {o.campaign && (
                        <span className="text-xs text-muted-foreground">{o.campaign.name}</span>
                      )}
                      <span>{money(board.currency, o.value)}</span>
                      {s.kind !== "OPEN" && (
                        <span className="text-xs font-medium">
                          {s.kind === "WON" ? "Won" : "Lost"}
                          {o.closedAt && ` · closed ${o.closedAt.slice(0, 10)}`}
                        </span>
                      )}
                      <select
                        ref={(el) => {
                          if (el) selects.current.set(o.id, el);
                          else selects.current.delete(o.id);
                        }}
                        aria-label={`Stage of ${o.title}`}
                        disabled={!canEdit}
                        value={o.stageId}
                        onChange={(e) => void move(o, e.target.value)}
                        className="h-8 rounded-md border border-border bg-card px-2 text-xs"
                      >
                        {board.stages.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </Card>
                  </li>
                ))}
              </ul>
              {s.more && (
                <p className="text-xs text-muted-foreground">
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
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onChanged={changed}
        />
      )}
      {creating && board && (
        <NewOpportunity
          stages={board.stages}
          campaigns={campaigns}
          onClose={() => setCreating(false)}
          onCreated={changed}
        />
      )}
    </div>
  );
}
