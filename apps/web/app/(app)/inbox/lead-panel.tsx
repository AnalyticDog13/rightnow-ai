"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { call, errorText } from "../accounts/api-client";
import { INTEREST } from "../leads/labels";
import type { Detail } from "./types";

const day = (iso: string) => new Date(iso).toLocaleDateString();

export function LeadPanel({
  d,
  canEdit,
  onChanged,
  onResult,
}: {
  d: Detail;
  canEdit: boolean;
  onChanged: () => void;
  onResult: (ok: string, err: string) => void;
}) {
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const lead = d.lead;
  const ooo = [...d.messages].reverse().find((m) => m.kind === "AUTO_REPLY" && m.oooUntil);
  const next = d.scheduled[0];

  async function addNote() {
    const r = await call("/api/v1/inbox/notes", "POST", { threadId: d.id, body: note });
    if (!r.ok) return onResult("", errorText(r));
    setNote("");
    onChanged();
  }

  // PS-INBOX-05: a reply from another address is linked to the lead it belongs to
  async function attach() {
    const found = await call(`/api/v1/leads?q=${encodeURIComponent(email.trim())}&take=1`, "GET");
    const id = (found.json.leads as { id: string }[] | undefined)?.[0]?.id;
    if (!id) return onResult("", "No lead matches that address.");
    const r = await call(`/api/v1/inbox/threads/${d.id}/attach-lead`, "POST", { leadId: id });
    if (!r.ok) return onResult("", errorText(r));
    onResult("Lead attached.", "");
    onChanged();
  }

  return (
    <aside
      aria-label="Lead"
      className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm"
    >
      {lead ? (
        <>
          <div>
            <p className="font-medium">
              {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email}
            </p>
            <p className="break-all text-muted-foreground">{lead.email}</p>
            {lead.companyName && <p>{lead.companyName}</p>}
            {lead.jobTitle && <p>{lead.jobTitle}</p>}
            {lead.interestStatus !== null && <p>Status: {INTEREST[String(lead.interestStatus)]}</p>}
            {lead.labels.length > 0 && <p>Labels: {lead.labels.join(", ")}</p>}
            {lead.deletedAt && <p className="text-muted-foreground">This lead was deleted.</p>}
          </div>
          {d.origin && (
            <p>
              Campaign: {d.origin.campaign.name}
              <br />
              Started by Step {d.origin.step.order}
              {d.origin.variant ? `, Variant ${d.origin.variant.label}` : ""}
            </p>
          )}
          {ooo && <p>Out of office until {day(ooo.oooUntil!)}. Follow-ups resume then.</p>}
          {next && (
            <p>
              Next email: {next.renderedSubject} on {new Date(next.dueAt).toLocaleString()}{" "}
              <Link href="/scheduled" className="underline">
                Scheduled emails
              </Link>
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p>No lead is linked to this conversation.</p>
          {canEdit && (
            <>
              <Input
                aria-label="Lead email"
                placeholder="lead@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button variant="outline" disabled={!email.trim()} onClick={() => void attach()}>
                Attach lead
              </Button>
            </>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Notes</h3>
        <ul className="flex flex-col gap-1">
          {[...d.leadNotes, ...d.notes].map((n) => (
            <li key={n.id} className="rounded bg-muted p-2">
              {n.body}
            </li>
          ))}
        </ul>
        {canEdit && (
          <>
            <label htmlFor="new-note">New note</label>
            <textarea
              id="new-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-md border border-border bg-card p-2 focus-visible:outline-2 focus-visible:outline-primary"
            />
            <Button variant="outline" disabled={!note.trim()} onClick={() => void addNote()}>
              Add note
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}
