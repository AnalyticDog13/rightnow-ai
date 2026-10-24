"use client";

import { useState } from "react";
import { call, errorText } from "../app/(app)/accounts/api-client";
import { Button } from "./ui/button";

/**
 * One AI action (D47): POST `/api/v1/ai/<path>`, show the model text, and for a reviewable kind offer Use / Discard.
 * "Use" approves the suggestion through the review API and only then hands the text to `onUse` (the editor or the composer):
 * nothing is sent from here. Without `onUse` the text is shown for reading (summaries, analysis).
 */
export function AiAssist({
  label,
  path,
  body,
  onUse,
  disabled,
}: {
  label: string;
  path: string;
  body: Record<string, unknown>;
  onUse?: (text: string) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState("");

  async function go() {
    setBusy(true);
    setErr("");
    const r = await call(`/api/v1/ai/${path}`, "POST", body);
    setBusy(false);
    if (r.ok) setResult({ id: String(r.json.id), text: String(r.json.text ?? "") });
    else
      setErr(
        r.status === 412 ? "AI is not set up. An admin can add a model in Settings." : errorText(r),
      );
  }
  async function review(status: "APPROVED" | "REJECTED") {
    const r = await call(`/api/v1/ai/suggestions/${result!.id}`, "PATCH", { status });
    if (!r.ok) return setErr(errorText(r));
    if (status === "APPROVED") onUse?.(String(r.json.text ?? ""));
    setResult(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void go()}>
        {busy ? "Thinking..." : label}
      </Button>
      {err && (
        <p role="alert" className="text-sm text-red-600">
          {err}
        </p>
      )}
      {result && (
        <div
          role="region"
          aria-label={`${label}: result`}
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <p className="whitespace-pre-wrap text-sm">{result.text}</p>
          <div className="flex gap-2">
            {onUse ? (
              <>
                <Button type="button" onClick={() => void review("APPROVED")}>
                  Use
                </Button>
                <Button type="button" variant="outline" onClick={() => void review("REJECTED")}>
                  Discard
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={() => setResult(null)}>
                Close
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
