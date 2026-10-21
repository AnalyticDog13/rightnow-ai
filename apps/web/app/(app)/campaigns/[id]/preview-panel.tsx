"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { call, errorText } from "../../accounts/api-client";

type Lead = { id: string; email: string; firstName: string | null };
type Issue = { code: string; message: string; field?: string };
type Out = { subject: string; html: string | null; text: string; issues: Issue[] };
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

/** The email exactly as the sender would build it for one real lead (same render + footer), plus a step test-send. */
export function PreviewPanel({
  campaignId,
  stepId,
  variantId,
  isAdmin,
  onClose,
}: {
  campaignId: string;
  stepId: string;
  variantId: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadId, setLeadId] = useState("");
  const [out, setOut] = useState<Out | null>(null);
  const [error, setError] = useState("");
  const [to, setTo] = useState("");
  const [ok, setOk] = useState(false);
  const [sent, setSent] = useState("");

  useEffect(() => {
    dialog.current?.showModal(); // Escape closes it natively and fires `close`
    void call(`/api/v1/campaigns/${campaignId}/leads?take=50`, "GET").then((r) => {
      const l = (r.json.leads ?? []) as Lead[];
      setLeads(l);
      setLeadId(l[0]?.id ?? "");
      if (!l.length) setError("Enroll at least one lead to preview.");
    });
  }, [campaignId]);

  useEffect(() => {
    if (!leadId) return;
    let live = true;
    setSent("");
    void call(`/api/v1/campaigns/${campaignId}/preview`, "POST", {
      stepId,
      variantId,
      leadId,
    }).then((r) => {
      if (!live) return;
      setError(r.ok ? "" : errorText(r));
      setOut(r.ok ? (r.json as Out) : null);
    });
    return () => {
      live = false;
    };
  }, [campaignId, stepId, variantId, leadId]);

  async function sendTest() {
    setSent("Sending...");
    const r = await call(`/api/v1/campaigns/${campaignId}/test-send`, "POST", {
      stepId,
      variantId,
      leadId,
      to,
      confirmAuthorized: ok,
    });
    setSent(r.ok ? "Test email sent." : errorText(r));
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="preview-title"
      onClose={onClose}
      className="m-auto w-full max-w-2xl rounded-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/40"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id="preview-title" className="text-lg font-semibold">
          Preview
        </h2>
        <Button variant="outline" onClick={() => dialog.current?.close()}>
          Close
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Preview as lead
          <select className={sel} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.firstName ? `${l.firstName} (${l.email})` : l.email}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {out && (
          <>
            {out.issues.length > 0 && (
              <ul role="alert" className="list-disc pl-5 text-sm text-destructive">
                {out.issues.map((i, n) => (
                  <li key={n}>
                    {i.field ? `${i.field}: ` : ""}
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm">
              <span className="font-medium">Subject: </span>
              <span data-testid="preview-subject">{out.subject}</span>
            </p>
            {out.html !== null ? (
              <iframe
                title="Email body"
                sandbox=""
                srcDoc={out.html}
                className="h-64 w-full rounded-md border border-border bg-white"
              />
            ) : (
              <pre className="whitespace-pre-wrap rounded-md border border-border p-3 text-sm">
                {out.text}
              </pre>
            )}
          </>
        )}
        {isAdmin && (
          <form
            className="flex flex-col gap-2 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void sendTest();
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-medium">
              Send test to
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I am
              authorized to send from this campaign&apos;s account
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!ok || !to.trim() || !leadId}>
                Send test
              </Button>
              <p role="status" className="text-sm">
                {sent}
              </p>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
