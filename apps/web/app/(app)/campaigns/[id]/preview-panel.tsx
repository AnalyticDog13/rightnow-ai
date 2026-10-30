"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Callout } from "../../../../components/callout";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Select } from "../../../../components/ui/select";
import { call, errorText } from "../../accounts/api-client";

type Lead = { id: string; email: string; firstName: string | null };
type Issue = { code: string; message: string; field?: string };
type Out = { subject: string; html: string | null; text: string; issues: Issue[] };

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
      className="m-auto w-[min(640px,calc(100vw-32px))] max-w-none overflow-y-auto rounded-xl bg-surface p-6 text-fg shadow-e3 open:animate-pop max-md:mb-0 max-md:max-h-[90dvh] max-md:w-screen max-md:rounded-b-none md:max-h-[calc(100dvh-64px)]"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id="preview-title" className="text-lg/[26px] font-semibold">
          Preview
        </h2>
        <Button variant="ghost" size="sm" onClick={() => dialog.current?.close()}>
          <X aria-hidden />
          Close
        </Button>
      </div>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[13px]/[18px] font-medium">
          Preview as lead
          <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.firstName ? `${l.firstName} (${l.email})` : l.email}
              </option>
            ))}
          </Select>
        </label>
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
        {out && (
          <>
            {out.issues.length > 0 && (
              <ul role="alert" className="list-disc pl-5 text-[13px]/[18px] text-danger">
                {out.issues.map((i, n) => (
                  <li key={n}>
                    {i.field ? `${i.field}: ` : ""}
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-border px-4 py-3 text-[13px]/[18px]">
                <dt className="text-fg-muted">To</dt>
                <dd className="truncate">{leads.find((l) => l.id === leadId)?.email}</dd>
                <dt className="text-fg-muted">Subject</dt>
                <dd className="font-medium" data-testid="preview-subject">
                  {out.subject}
                </dd>
              </dl>
              {out.html !== null ? (
                <iframe
                  title="Email body"
                  sandbox=""
                  srcDoc={out.html}
                  className="h-64 w-full bg-white"
                />
              ) : (
                <pre className="p-4 font-sans text-sm whitespace-pre-wrap">{out.text}</pre>
              )}
            </div>
          </>
        )}
        {isAdmin && (
          <form
            className="flex flex-col gap-3 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void sendTest();
            }}
          >
            <label className="flex flex-col gap-1.5 text-[13px]/[18px] font-medium">
              Send test to
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-0">
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I am
              authorized to send from this campaign&apos;s account
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="outline" disabled={!ok || !to.trim() || !leadId}>
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
