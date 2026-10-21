"use client";

import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
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

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={!canEdit} className="flex flex-col gap-3">
        {rows.map((s, i) => (
          <Card key={i} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Name of schedule ${i + 1}`}
                className="max-w-48"
                value={s.name}
                onChange={(e) => set(i, { name: e.target.value })}
              />
              {Object.entries(presets).map(([k, p]) => (
                <Button
                  key={k}
                  type="button"
                  variant="outline"
                  onClick={() => set(i, { ...p, name: PRESET_LABEL[k] ?? k })}
                >
                  {PRESET_LABEL[k] ?? k}
                </Button>
              ))}
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRows((o) => o.filter((_, n) => n !== i))}
                >
                  Remove schedule {i + 1}
                </Button>
              )}
            </div>
            <div
              role="group"
              aria-label={`Days of schedule ${i + 1}`}
              className="flex flex-wrap gap-3 text-sm"
            >
              {DAYS.map((d, bit) => (
                <label key={d} className="flex items-center gap-1">
                  <input
                    type="checkbox"
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
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                From
                <Input
                  type="time"
                  className="w-32"
                  value={s.from}
                  onChange={(e) => set(i, { from: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-1">
                To
                <Input
                  type={s.to === "24:00" ? "text" : "time"}
                  className="w-32"
                  value={s.to}
                  onChange={(e) => set(i, { to: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-1">
                Time zone
                <Input
                  className="w-48"
                  placeholder="Workspace time zone"
                  value={s.timezone}
                  onChange={(e) => set(i, { timezone: e.target.value })}
                />
              </label>
            </div>
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
          Add schedule
        </Button>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            Start date
            <Input
              type="date"
              className="w-40"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1">
            End date
            <Input
              type="date"
              className="w-40"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
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
