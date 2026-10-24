"use client";

import { useCallback, useEffect, useState } from "react";
import { call, errorText } from "../app/(app)/accounts/api-client";
import { Button } from "./ui/button";

type Lead = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
};
type Suggestion = {
  id: string;
  kind: string;
  text: string;
  leadId: string | null;
  lead?: Lead | null;
};

const who = (l: Lead) =>
  [[l.firstName, l.lastName].filter(Boolean).join(" "), l.companyName].filter(Boolean).join(", ");

/**
 * Pending AI suggestions with Approve / Reject (D47). Nothing here sends anything: approving a personalization stores it
 * on the lead, a draft is handed to `onApproved` for the human to use. `filter` is a query string, e.g. `jobId=...`.
 * Each row names its lead; "Approve all shown" covers only the loaded rows (`Load more` loads the next page).
 */
export function AiReview({
  filter = "",
  onApproved,
}: {
  filter?: string;
  onApproved?: (s: { id: string; text: string }) => void;
}) {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");

  const load = useCallback(
    async (cursor?: string) => {
      const r = await call(
        `/api/v1/ai/suggestions?status=PENDING&${filter}${cursor ? `&cursor=${cursor}` : ""}`,
        "GET",
      );
      if (!r.ok) return setErr(errorText(r));
      const got = (r.json.suggestions as Suggestion[] | undefined) ?? [];
      setRows((x) => (cursor ? [...x, ...got.filter((g) => !x.some((y) => y.id === g.id))] : got));
      setNext((r.json.nextCursor as string | null | undefined) ?? null);
      setTotal(Number(r.json.total ?? got.length));
    },
    [filter],
  );
  useEffect(() => void load(), [load]);

  async function review(id: string, status: "APPROVED" | "REJECTED") {
    const r = await call(`/api/v1/ai/suggestions/${id}`, "PATCH", { status });
    if (!r.ok) return setErr(errorText(r));
    setErr("");
    if (status === "APPROVED") onApproved?.({ id, text: String(r.json.text ?? "") });
    setRows((x) => x.filter((s) => s.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  }

  return (
    <div className="flex flex-col gap-2">
      {err && (
        <p role="alert" className="text-sm text-red-600">
          {err}
        </p>
      )}
      <Button variant="outline" className="self-start" onClick={() => void load()}>
        Refresh
      </Button>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
      )}
      {rows.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {rows.length} of {total} waiting
        </p>
      )}
      {rows.length > 1 && (
        <Button
          variant="outline"
          onClick={() => void Promise.all(rows.map((s) => review(s.id, "APPROVED")))}
        >
          Approve all shown
        </Button>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            {s.lead && (
              <p className="text-sm font-medium">
                {s.lead.email}
                {who(s.lead) && (
                  <span className="font-normal text-muted-foreground"> ({who(s.lead)})</span>
                )}
              </p>
            )}
            <p className="whitespace-pre-wrap text-sm">{s.text}</p>
            <div className="flex gap-2">
              <Button onClick={() => void review(s.id, "APPROVED")}>Approve</Button>
              <Button variant="outline" onClick={() => void review(s.id, "REJECTED")}>
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {next && (
        <Button variant="outline" className="self-start" onClick={() => void load(next)}>
          Load more
        </Button>
      )}
    </div>
  );
}
