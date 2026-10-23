"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call, errorText } from "../accounts/api-client";
import type { Named } from "../leads/bulk-bar";
import { Err, Head, sel } from "./ui";

export type Hook = {
  id: string;
  name: string | null;
  url: string;
  events: string[];
  campaignId: string | null;
  status: "ACTIVE" | "ERROR";
  lastError: string | null;
  disabledAt: string | null;
  headerNames: string[];
};
type Delivery = {
  id: string;
  eventId: string;
  eventType: string;
  status: "PENDING" | "SENDING" | "DELIVERED" | "FAILED";
  attempts: number;
  nextAttemptAt: string;
  lastStatus: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  payload: unknown;
};
type Res = Awaited<ReturnType<typeof call>>;

// a body the route's schema refused carries the reason in issues[0].message (e.g. invalid_header)
const why = (r: Res) =>
  (r.json.issues as { message?: string }[] | undefined)?.[0]?.message ?? errorText(r);
const label = (h: Hook) => h.name || h.url;
const when = (s: string) => new Date(s).toLocaleString();

export function WebhooksTab({
  hooks,
  reload,
  canEdit,
  campaigns,
  events,
  labels,
}: {
  hooks: Hook[] | null;
  reload: () => void;
  canEdit: boolean;
  campaigns: Named[];
  events: string[];
  labels: string[];
}) {
  const [editing, setEditing] = useState<Hook | "new" | null>(null);
  const [viewing, setViewing] = useState<Hook | null>(null);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // bumps the overview after anything that can change its counts

  // one request per webhook at a time, so a double click cannot race
  async function act(h: Hook, what: "test" | "resume" | "rotate-secret" | "delete") {
    if (
      what === "delete" &&
      !confirm(`Delete webhook ${label(h)}? Its delivery log is deleted too.`)
    )
      return;
    if (
      what === "rotate-secret" &&
      !confirm(`Rotate the secret of ${label(h)}? The old one stops working at once.`)
    )
      return;
    setBusy(h.id);
    setNotice("");
    const r =
      what === "delete"
        ? await call(`/api/v1/webhooks/${h.id}`, "DELETE")
        : await call(`/api/v1/webhooks/${h.id}/${what}`, "POST");
    setBusy(null);
    setError(r.ok ? "" : why(r));
    if (r.ok && what === "test")
      setNotice(
        r.json.error
          ? `Test of ${label(h)} failed: ${String(r.json.error)}`
          : `Test of ${label(h)}: HTTP ${String(r.json.status)} in ${String(r.json.latencyMs)} ms`,
      );
    if (r.ok && what === "rotate-secret")
      setSecret({ name: label(h), value: String(r.json.secret) });
    if (r.ok && what === "delete" && viewing?.id === h.id) setViewing(null);
    setTick((t) => t + 1);
    reload();
  }

  if (editing)
    return (
      <HookForm
        hook={editing === "new" ? null : editing}
        campaigns={campaigns}
        events={events}
        labels={labels}
        onCancel={() => setEditing(null)}
        onSaved={(created) => {
          setEditing(null);
          if (created) setSecret(created);
          reload();
        }}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Each event is sent as a signed JSON POST (header X-RightNow-Signature) to your URL.
      </p>
      {canEdit && (
        <div>
          <Button onClick={() => setEditing("new")}>New webhook</Button>
        </div>
      )}
      {secret && (
        <Card role="region" aria-label="Signing secret" className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            Signing secret for {secret.name}. It is shown only once; copy it now.
          </p>
          <Input
            readOnly
            aria-label="Signing secret value"
            value={secret.value}
            onFocus={(e) => e.target.select()}
          />
          <div>
            <Button variant="outline" onClick={() => setSecret(null)}>
              I have saved it
            </Button>
          </div>
        </Card>
      )}
      <Err text={error} />
      <p role="status" className="text-sm">
        {notice}
      </p>
      {hooks && !hooks.length && <p className="text-sm text-muted-foreground">No webhooks yet.</p>}
      {!!hooks?.length && (
        <Card className="overflow-x-auto p-0">
          <table aria-label="Webhooks" className="w-full text-left text-sm">
            <Head cols={["Name", "Events", "Status", "Actions"]} />
            <tbody>
              {hooks.map((h) => (
                <tr key={h.id} className="border-b border-border align-top">
                  <td className="p-3">
                    <div className="font-medium">{label(h)}</div>
                    {h.name && (
                      <div className="break-all text-xs text-muted-foreground">{h.url}</div>
                    )}
                  </td>
                  <td className="p-3">{h.events.join(", ")}</td>
                  <td className="p-3">
                    {h.status === "ACTIVE" ? (
                      "Active"
                    ) : (
                      <span className="text-destructive">
                        Error since {h.disabledAt ? when(h.disabledAt) : "unknown"}
                        {h.lastError && <span className="block text-xs">{h.lastError}</span>}
                      </span>
                    )}
                  </td>
                  <td className="flex flex-wrap gap-2 p-3">
                    <Button
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      aria-label={`Deliveries of ${label(h)}`}
                      onClick={() => setViewing(h)}
                    >
                      Deliveries
                    </Button>
                    {canEdit && (
                      <>
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          aria-label={`Test ${label(h)}`}
                          disabled={busy === h.id}
                          onClick={() => void act(h, "test")}
                        >
                          Test
                        </Button>
                        {h.status === "ERROR" && (
                          <Button
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            aria-label={`Resume ${label(h)}`}
                            disabled={busy === h.id}
                            onClick={() => void act(h, "resume")}
                          >
                            Resume
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          aria-label={`Edit ${label(h)}`}
                          onClick={() => setEditing(h)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          aria-label={`Rotate secret of ${label(h)}`}
                          disabled={busy === h.id}
                          onClick={() => void act(h, "rotate-secret")}
                        >
                          Rotate secret
                        </Button>
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          aria-label={`Delete ${label(h)}`}
                          disabled={busy === h.id}
                          onClick={() => void act(h, "delete")}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Overview tick={tick} />
      {viewing && (
        <Deliveries
          key={viewing.id}
          hook={viewing}
          canEdit={canEdit}
          onClose={() => setViewing(null)}
          onRedelivered={(m) => {
            setNotice(m);
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

function HookForm({
  hook,
  campaigns,
  events,
  labels,
  onSaved,
  onCancel,
}: {
  hook: Hook | null;
  campaigns: Named[];
  events: string[];
  labels: string[];
  onSaved: (created?: { name: string; value: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(hook?.name ?? "");
  const [url, setUrl] = useState(hook?.url ?? "");
  const [chosen, setChosen] = useState(hook?.events ?? []);
  const [campaignId, setCampaignId] = useState(hook?.campaignId ?? "");
  // header values are never returned, so on edit they are replaced only when asked
  const [replace, setReplace] = useState(!hook);
  const [rows, setRows] = useState<{ k: string; v: string }[]>([]);
  const [error, setError] = useState("");
  const toggle = (e: string) =>
    setChosen((s) => (s.includes(e) ? s.filter((x) => x !== e) : [...s, e]));
  const setRow = (i: number, d: Partial<{ k: string; v: string }>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...d } : x)));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!chosen.length) return setError("Choose at least one event");
    const headers = Object.fromEntries(
      rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]),
    );
    const body = {
      name: name.trim() || null,
      url: url.trim(),
      events: chosen,
      campaignId: campaignId || null,
      ...(replace && { headers: Object.keys(headers).length ? headers : null }),
    };
    const r = await call(
      hook ? `/api/v1/webhooks/${hook.id}` : "/api/v1/webhooks",
      hook ? "PATCH" : "POST",
      body,
    );
    if (!r.ok) return setError(why(r));
    onSaved(hook ? undefined : { name: name.trim() || url.trim(), value: String(r.json.secret) });
  }

  return (
    <Card>
      <form
        onSubmit={save}
        className="flex flex-col gap-4"
        aria-label={hook ? "Edit webhook" : "New webhook"}
      >
        <h2 className="text-lg font-medium">{hook ? "Edit webhook" : "New webhook"}</h2>
        <Err text={error} />
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="hook-name">Name</Label>
            <Input
              id="hook-name"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex min-w-72 flex-1 flex-col gap-1">
            <Label htmlFor="hook-url">URL</Label>
            <Input
              id="hook-url"
              type="url"
              required
              maxLength={2048}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="hook-campaign">Campaign</Label>
            <select
              id="hook-campaign"
              className={sel}
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              <option value="">Any campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Events</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {["all_events", ...events, ...labels].map((e) => (
              <label key={e} className="flex items-center gap-1">
                <input type="checkbox" checked={chosen.includes(e)} onChange={() => toggle(e)} />
                {e}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Custom headers</legend>
          {hook && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              Replace the stored headers
              {hook.headerNames.length
                ? ` (${hook.headerNames.join(", ")}; values are not shown)`
                : ""}
            </label>
          )}
          {replace && (
            <>
              {rows.map((r, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`hdr-k-${i}`}>Header name {i + 1}</Label>
                    <Input
                      id={`hdr-k-${i}`}
                      maxLength={64}
                      value={r.k}
                      onChange={(e) => setRow(i, { k: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`hdr-v-${i}`}>Header value {i + 1}</Label>
                    <Input
                      id={`hdr-v-${i}`}
                      maxLength={1024}
                      value={r.v}
                      onChange={(e) => setRow(i, { v: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Remove header ${i + 1}`}
                    onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={rows.length >= 10}
                  onClick={() => setRows((x) => [...x, { k: "", v: "" }])}
                >
                  Add header
                </Button>
              </div>
            </>
          )}
        </fieldset>
        <div className="flex gap-2">
          <Button type="submit">Save webhook</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Deliveries({
  hook,
  canEdit,
  onClose,
  onRedelivered,
}: {
  hook: Hook;
  canEdit: boolean;
  onClose: () => void;
  onRedelivered: (message: string) => void;
}) {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Delivery | null>(null);
  const current = useRef(status);

  const load = useCallback(
    async (cursor?: string) => {
      const q = new URLSearchParams({
        ...(status && { status }),
        ...(cursor && { cursor }),
      }).toString();
      const r = await call(`/api/v1/webhooks/${hook.id}/deliveries${q && `?${q}`}`, "GET");
      if (status !== current.current) return; // the filter moved on
      if (!r.ok) return setError(errorText(r));
      setError("");
      setRows((old) => [...(cursor ? (old ?? []) : []), ...(r.json.deliveries as Delivery[])]);
      setNext(r.json.nextCursor as string | null);
    },
    [hook.id, status],
  );
  useEffect(() => {
    current.current = status;
    setRows(null);
    setNext(null);
    void load();
  }, [status, load]);

  async function redeliver(d: Delivery) {
    const r = await call(`/api/v1/webhooks/deliveries/${d.id}/redeliver`, "POST");
    setError(r.ok ? "" : why(r));
    if (!r.ok) return;
    // keep the loaded pages: only this row changes
    setRows((old) =>
      (old ?? []).map((x) =>
        x.id === d.id
          ? { ...x, status: "PENDING", attempts: 0, nextAttemptAt: new Date().toISOString() }
          : x,
      ),
    );
    onRedelivered(`Queued ${d.eventType} for redelivery`);
  }

  return (
    <Card role="region" aria-label={`Deliveries of ${label(hook)}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-lg font-medium">Deliveries: {label(hook)}</h2>
        <div className="flex flex-col gap-1">
          <Label htmlFor="deliv-status">Status</Label>
          <select
            id="deliv-status"
            className={sel}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            {["PENDING", "DELIVERED", "FAILED"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Button className="ml-auto" variant="ghost" onClick={onClose}>
          Close deliveries
        </Button>
      </div>
      <Err text={error} />
      {rows && !rows.length && <p className="text-sm text-muted-foreground">No deliveries.</p>}
      {!!rows?.length && (
        <div className="overflow-x-auto">
          <table aria-label="Deliveries" className="w-full text-left text-sm">
            <Head
              cols={["Event", "Status", "Code", "Latency", "Attempts", "Next attempt", "Actions"]}
            />
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-border">
                  <td className="p-3">{d.eventType}</td>
                  <td className="p-3">
                    {d.status}
                    {d.lastError && (
                      <span className="block text-xs text-muted-foreground">{d.lastError}</span>
                    )}
                  </td>
                  <td className="p-3">{d.lastStatus ?? "-"}</td>
                  <td className="p-3">
                    {d.lastLatencyMs === null ? "-" : `${d.lastLatencyMs} ms`}
                  </td>
                  <td className="p-3">{d.attempts}</td>
                  <td className="p-3">{d.status === "PENDING" ? when(d.nextAttemptAt) : "-"}</td>
                  <td className="flex gap-2 p-3">
                    <Button
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      aria-label={`View payload of ${d.eventType} ${d.eventId}`}
                      onClick={() => setOpen(d)}
                    >
                      Payload
                    </Button>
                    {canEdit && (d.status === "DELIVERED" || d.status === "FAILED") && (
                      <Button
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        aria-label={`Redeliver ${d.eventType} ${d.eventId}`}
                        onClick={() => void redeliver(d)}
                      >
                        Redeliver
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <div>
          <Button variant="outline" onClick={() => void load(next)}>
            Load more
          </Button>
        </div>
      )}
      {open && (
        <div role="region" aria-label="Payload" className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h3 className="font-medium">Payload of {open.eventType}</h3>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Close payload
            </Button>
          </div>
          <pre
            tabIndex={0}
            aria-label="Payload JSON"
            className="max-h-80 overflow-auto rounded-md border border-border p-3 text-xs"
          >
            {JSON.stringify(open.payload, null, 2)}
          </pre>
        </div>
      )}
    </Card>
  );
}

type Day = { day: string; delivered: number; failed: number };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** PS-ANALYTICS-19: delivered vs failed attempts per day, last 14 days; the table is the text alternative. */
function Overview({ tick }: { tick: number }) {
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    // the server buckets by workspace timezone: ending tomorrow (UTC) keeps the local today in range
    const to = new Date(Date.now() + 86_400_000);
    const from = new Date(to.getTime() - 14 * 86_400_000);
    void call(`/api/v1/webhooks/overview?from=${iso(from)}&to=${iso(to)}`, "GET").then((r) => {
      if (!r.ok) return setError(errorText(r));
      setDays(r.json.days as Day[]);
    });
  }, [tick]);
  const axis = { tick: { fontSize: 12 }, stroke: "currentColor" };
  return (
    <figure
      aria-label="Deliveries per day"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
    >
      <figcaption className="text-sm font-medium">
        Deliveries per day, last 14 days{" "}
        <span className="font-normal text-muted-foreground">(figures in the table below)</span>
      </figcaption>
      <Err text={error} />
      {days && !days.length && (
        <p className="text-sm text-muted-foreground">No delivery attempts yet.</p>
      )}
      {!!days?.length && (
        <>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="delivered"
                  name="Delivered"
                  fill="#059669"
                  isAnimationActive={false}
                />
                <Bar dataKey="failed" name="Failed" fill="#dc2626" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table aria-label="Deliveries by day" className="w-full text-left text-sm">
            <Head cols={["Day", "Delivered", "Failed"]} />
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className="border-b border-border">
                  <td className="p-2">{d.day}</td>
                  <td className="p-2">{d.delivered}</td>
                  <td className="p-2">{d.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </figure>
  );
}
