"use client";

import { Paperclip, ThumbsDown, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { call, errorText } from "../accounts/api-client";
import { INTEREST } from "../leads/labels";
import { Composer } from "./composer";
import { DeleteLeadDialog } from "./delete-lead-dialog";
import { LeadPanel } from "./lead-panel";
import { MessageFrame } from "./message-frame";
import { CATEGORIES, who, type Detail } from "./types";

const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";
type Opt = { id: string; name: string };
const KIND: Record<string, string> = {
  AUTO_REPLY: "Auto-reply",
  BOUNCE: "Bounce",
  UNSUBSCRIBE: "Unsubscribe request",
};
const size = (n: number) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const localInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function ThreadView({
  id,
  canEdit,
  isAdmin,
  onRead,
  onChanged,
  onDeleted,
}: {
  id: string;
  canEdit: boolean;
  isAdmin: boolean;
  onRead: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  const [remind, setRemind] = useState("");
  const [subs, setSubs] = useState<Opt[]>([]);
  const [campaigns, setCampaigns] = useState<Opt[]>([]);
  const [dialog, setDialog] = useState(false);
  const result = (o: string, e: string) => {
    setOk(o);
    setErr(e);
  };

  const load = useCallback(async () => {
    const r = await call(`/api/v1/inbox/threads/${id}`, "GET");
    if (!r.ok) {
      setErr(errorText(r));
      return null;
    }
    const t = r.json as unknown as Detail;
    setD(t);
    setRemind(localInput(t.reminderAt));
    return t;
  }, [id]);

  useEffect(() => {
    setD(null);
    setOk("");
    setErr("");
    void load().then(async (t) => {
      // only unread threads: read-all answers 404 for one that is already read
      if (t && !t.isRead && (await call(`/api/v1/inbox/threads/${id}/read-all`, "POST")).ok)
        onRead();
    });
  }, [id, load]);

  useEffect(() => {
    if (!d?.campaignId) return setSubs([]);
    void call(`/api/v1/campaigns/${d.campaignId}/steps`, "GET").then((r) =>
      setSubs((r.json.subsequences as Opt[] | undefined) ?? []),
    );
  }, [d?.campaignId]);
  useEffect(() => {
    void call("/api/v1/campaigns", "GET").then((r) =>
      setCampaigns((r.json.campaigns as Opt[] | undefined) ?? []),
    );
  }, []);

  async function patch(body: unknown, done: string) {
    const r = await call(`/api/v1/inbox/threads/${id}`, "PATCH", body);
    result(r.ok ? done : "", r.ok ? "" : errorText(r));
    if (r.ok) {
      await load();
      onChanged();
    }
  }
  async function act(url: string, method: string, body: unknown, done: string) {
    const r = await call(url, method, body);
    result(r.ok ? done : "", r.ok ? "" : errorText(r));
    if (r.ok) await load();
  }
  async function removeConversation() {
    const r = await call(`/api/v1/inbox/threads/${id}`, "DELETE");
    if (r.ok) onDeleted();
    else result("", errorText(r));
  }

  if (!d)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading conversation...
      </p>
    );
  const lead = d.lead;
  return (
    <div
      role="region"
      aria-label="Conversation"
      className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{d.subject}</h2>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2">
              {lead && (
                <label className="flex flex-col gap-1 text-xs">
                  Interest status
                  <select
                    className={sel}
                    value={lead.interestStatus ?? ""}
                    onChange={(e) =>
                      void act(
                        `/api/v1/leads/${lead.id}`,
                        "PATCH",
                        { interestStatus: e.target.value === "" ? null : Number(e.target.value) },
                        "Status updated.",
                      )
                    }
                  >
                    <option value="">None</option>
                    {Object.entries(INTEREST).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs">
                <span>
                  Category
                  {d.categorySource === "AI" && (
                    <span className="ml-1 rounded bg-muted px-1 text-[10px] font-medium uppercase">
                      AI
                    </span>
                  )}
                </span>
                <select
                  className={sel}
                  value={d.category ?? ""}
                  onChange={(e) =>
                    e.target.value && void patch({ category: e.target.value }, "Category updated.")
                  }
                >
                  <option value="" disabled>
                    Not set
                  </option>
                  {Object.entries(CATEGORIES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Reminder
                <input
                  type="datetime-local"
                  className={sel}
                  value={remind}
                  onChange={(e) => setRemind(e.target.value)}
                />
              </label>
              <Button
                variant="outline"
                disabled={!remind}
                onClick={() =>
                  void patch({ reminderAt: new Date(remind).toISOString() }, "Reminder set.")
                }
              >
                Set reminder
              </Button>
              {d.reminderAt && (
                <Button
                  variant="outline"
                  onClick={() => void patch({ reminderAt: null }, "Reminder cleared.")}
                >
                  Clear reminder
                </Button>
              )}
              {d.campaignLeadId && subs.length > 0 && (
                <label className="flex flex-col gap-1 text-xs">
                  Move to subsequence
                  <select
                    className={sel}
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      void act(
                        `/api/v1/campaigns/${d.campaignId}/leads/${d.campaignLeadId}`,
                        "POST",
                        { action: "move_to_subsequence", subsequenceId: e.target.value },
                        "Moved to subsequence.",
                      )
                    }
                  >
                    <option value="">Choose</option>
                    {subs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {lead && (
                <label className="flex flex-col gap-1 text-xs">
                  Add to another campaign
                  <select
                    className={sel}
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      void act(
                        `/api/v1/campaigns/${e.target.value}/leads`,
                        "POST",
                        { leadIds: [lead.id] },
                        "Added to campaign.",
                      )
                    }
                  >
                    <option value="">Choose</option>
                    {campaigns
                      .filter((c) => c.id !== d.campaignId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <Button variant="outline" onClick={() => void removeConversation()}>
                Delete conversation
              </Button>
              {lead && !lead.deletedAt && (
                <Button variant="outline" onClick={() => setDialog(true)}>
                  Delete or block lead
                </Button>
              )}
            </div>
          )}
          <p role="status" className="text-sm">
            {ok}
          </p>
          <p role="alert" className="text-sm text-red-600">
            {err}
          </p>
        </div>

        {d.messages.map((m) => (
          <article
            key={m.id}
            aria-label={`Message from ${who(m)}`}
            className="flex flex-col gap-2 rounded-md border border-border p-3"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {who(m)}{" "}
                <span className="font-normal text-muted-foreground">
                  &lt;{m.fromEmail}&gt; to {m.to.join(", ")}
                </span>
              </span>
              <span className="text-muted-foreground">
                {KIND[m.kind] ? `${KIND[m.kind]} · ` : ""}
                {new Date(m.sentAt).toLocaleString()}
              </span>
            </header>
            <MessageFrame html={m.html} text={m.text} />
            {canEdit && d.categorySource === "AI" && m.direction === "IN" && m.category && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                AI tagged this {CATEGORIES[m.category]?.toLowerCase() ?? "reply"}. Right?
                {([1, -1] as const).map((vote) => (
                  <Button
                    key={vote}
                    variant="outline"
                    aria-label={vote === 1 ? "Good AI tag" : "Wrong AI tag"}
                    aria-pressed={m.aiFeedback === vote}
                    onClick={() =>
                      void act(
                        `/api/v1/inbox/messages/${m.id}/ai-feedback`,
                        "POST",
                        { vote },
                        "Thanks for the feedback.",
                      )
                    }
                  >
                    {vote === 1 ? (
                      <ThumbsUp className="size-3" />
                    ) : (
                      <ThumbsDown className="size-3" />
                    )}
                  </Button>
                ))}
              </div>
            )}
            {m.attachments.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-sm">
                {m.attachments.map((a) => (
                  <li key={a.id}>
                    <Paperclip className="mr-1 inline size-3" aria-hidden />
                    {a.truncated ? (
                      `${a.filename} (too large to keep)`
                    ) : (
                      <a className="underline" href={`/api/v1/inbox/attachments/${a.id}`} download>
                        {a.filename}
                      </a>
                    )}{" "}
                    <span className="text-muted-foreground">{size(a.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}

        {canEdit && (
          <Composer
            threadId={id}
            onResult={result}
            onSent={() => {
              void load();
              onChanged();
            }}
          />
        )}
      </div>
      <LeadPanel d={d} canEdit={canEdit} onChanged={() => void load()} onResult={result} />
      {dialog && lead && (
        <DeleteLeadDialog
          lead={lead}
          isAdmin={isAdmin}
          onClose={() => setDialog(false)}
          onDone={(m) => {
            setDialog(false);
            result(m, "");
            void load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
