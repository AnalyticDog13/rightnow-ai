"use client";

import { Info, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { call, errorText } from "../../accounts/api-client";
import type { CampaignView } from "./campaign-builder";

type Row = { name: string; timezone: string; days: number; from: string; to: string };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // Sun = bit 0
const PRESET_LABEL: Record<string, string> = { anyTime: "Any time", officeHours: "Office hours" };

/** The day a stored instant falls on in `zone`, as the YYYY-MM-DD the API takes. */
const dayIn = (iso: string | null, zone: string, offsetMs = 0) =>
  iso
    ? new Intl.DateTimeFormat("sv-SE", { timeZone: zone || "UTC" }).format(
        new Date(Date.parse(iso) + offsetMs),
      )
    : "";

export function ScheduleTab({
  campaignId,
  campaign,
  presets,
  canEdit,
  onChange,
}: {
  campaignId: string;
  campaign: CampaignView;
  presets: Record<string, { days: number; from: string; to: string }>;
  canEdit: boolean;
  onChange: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(campaign.schedules);
  const zone = rows[0]?.timezone ?? "";
  const [start, setStart] = useState(dayIn(campaign.startAt, zone));
  const [end, setEnd] = useState(dayIn(campaign.endAt, zone, -1)); // endAt is the midnight after the last day
  const [msg, setMsg] = useState("");
  const set = (i: number, patch: Partial<Row>) =>
    setRows((o) => o.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  async function save() {
    const r = await call(`/api/v1/campaigns/${campaignId}/schedules`, "PUT", {
      schedules: rows.map((s) => ({ ...s, timezone: s.timezone.trim() || undefined })),
      startDate: start || null,
      endDate: end || null,
    });
    setMsg(r.ok ? "Schedule saved." : errorText(r));
    if (r.ok) onChange();
  }

  const micro = "micro text-fg-muted";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="flex items-center gap-1.5 text-[13px]/[18px] text-fg-muted">
        <Info className="size-3.5 shrink-0" aria-hidden />
        Emails are spaced across the window; backlog is never burst-sent.
      </p>
      <fieldset disabled={!canEdit} className="flex flex-col gap-3">
        {rows.map((s, i) => (
          <Card key={i} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Name of schedule ${i + 1}`}
                className="font-medium md:w-56"
                value={s.name}
                onChange={(e) => set(i, { name: e.target.value })}
              />
              {Object.entries(presets).map(([k, p]) => (
                <Button
                  key={k}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => set(i, { ...p, name: PRESET_LABEL[k] ?? k })}
                >
                  {PRESET_LABEL[k] ?? k}
                </Button>
              ))}
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  className="md:ml-auto"
                  onClick={() => setRows((o) => o.filter((_, n) => n !== i))}
                >
                  <Trash2 aria-hidden />
                  Remove schedule {i + 1}
                </Button>
              )}
            </div>
            <dl className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center md:gap-x-6">
              <dt className={micro}>Days</dt>
              <dd
                role="group"
                aria-label={`Days of schedule ${i + 1}`}
                className="flex flex-wrap gap-1.5"
              >
                {DAYS.map((d, bit) => (
                  <label
                    key={d}
                    className="inline-flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-surface px-2.5 text-[13px]/[18px] font-medium text-fg-muted transition-colors duration-(--dur-1) has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring md:h-8"
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={(s.days & (1 << bit)) !== 0}
                      onChange={(e) =>
                        set(i, {
                          days: e.target.checked ? s.days | (1 << bit) : s.days & ~(1 << bit),
                        })
                      }
                    />
                    {d}
                  </label>
                ))}
              </dd>
              <dt className={micro}>Hours</dt>
              <dd className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  From
                  <Input
                    type="time"
                    className="w-32"
                    value={s.from}
                    onChange={(e) => set(i, { from: e.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  To
                  <Input
                    type={s.to === "24:00" ? "text" : "time"}
                    className="w-32"
                    value={s.to}
                    onChange={(e) => set(i, { to: e.target.value })}
                  />
                </label>
              </dd>
              <dt className={micro}>Time zone</dt>
              <dd>
                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only">Time zone</span>
                  <Input
                    className="md:w-64"
                    placeholder="Workspace time zone"
                    value={s.timezone}
                    onChange={(e) => set(i, { timezone: e.target.value })}
                  />
                </label>
              </dd>
            </dl>
          </Card>
        ))}
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() =>
            setRows((o) => [
              ...o,
              { name: "Schedule", timezone: "", days: 62, from: "09:00", to: "17:00" },
            ])
          }
        >
          <Plus aria-hidden />
          Add schedule
        </Button>
        <Card className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sched-start">Start date</Label>
            <Input
              id="sched-start"
              type="date"
              className="w-44"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sched-end">End date</Label>
            <Input
              id="sched-end"
              type="date"
              className="w-44"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </Card>
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={rows.length === 0}>
            Save schedule
          </Button>
          <p role="status" className="text-sm">
            {msg}
          </p>
        </div>
      )}
    </form>
  );
}
