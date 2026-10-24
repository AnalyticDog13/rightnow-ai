"use client";

import { useCallback, useEffect, useState } from "react";
import { call, errorText } from "../app/(app)/accounts/api-client";
import { Button } from "./ui/button";

type Suggestion = { id: string; kind: string; text: string; leadId: string | null };

/**
 * Pending AI suggestions with Approve / Reject (D47). Nothing here sends anything: approving a personalization stores it
 * on the lead, a draft is handed to `onApproved` for the human to use. `filter` is a query string, e.g. `jobId=...`.
 */
export function AiReview({
  filter = "",
  onApproved,
}: {
  filter?: string;
  onApproved?: (s: { id: string; text: string }) => void;
}) {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await call(`/api/v1/ai/suggestions?status=PENDING&${filter}`, "GET");
    if (r.ok) setRows((r.json.suggestions as Suggestion[] | undefined) ?? []);
    else setErr(errorText(r));
  }, [filter]);
  useEffect(() => void load(), [load]);

  async function review(id: string, status: "APPROVED" | "REJECTED") {
    const r = await call(`/api/v1/ai/suggestions/${id}`, "PATCH", { status });
    if (!r.ok) return setErr(errorText(r));
    setErr("");
    if (status === "APPROVED") onApproved?.({ id, text: String(r.json.text ?? "") });
    setRows((x) => x.filter((s) => s.id !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      {err && (
        <p role="alert" className="text-sm text-red-600">
          {err}
        </p>
      )}
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
      )}
      <Button variant="outline" className="self-start" onClick={() => void load()}>
        Refresh
      </Button>
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
    </div>
  );
}
