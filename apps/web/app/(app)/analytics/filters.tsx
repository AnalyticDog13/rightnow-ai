"use client";

import { SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { field, Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import type { Member, Named } from "../leads/bulk-bar";
import { preset } from "./query";

// every URL key the bar sets; "Reset" clears them all
const KEYS = [
  "from",
  "to",
  "tz",
  "campaignIds",
  "accountIds",
  "campaignTag",
  "ownerId",
  "status",
  "esp",
  "listId",
  "tag",
];
const ESPS = ["GOOGLE", "MICROSOFT", "ZOHO", "YAHOO", "YANDEX", "OTHER", "NOT_FOUND", "IN_QUEUE"];

/** Every filter lives in the page URL, so a view can be bookmarked and shared. */
export function Filters({
  campaigns,
  accounts,
  lists,
  members,
  timezone,
  today,
}: {
  campaigns: Named[];
  accounts: Named[];
  lists: Named[];
  members: Member[];
  timezone: string;
  today: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const [open, setOpen] = useState(false); // below 768 the bar folds behind a "Filters (n)" button
  const count = KEYS.filter((k) => k !== "to" && get(k)).length;

  function set(patch: Record<string, string>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`${path}?${p}`, { scroll: false });
  }

  const from = get("from");
  const to = get("to");
  const days = [7, 30, 90].find((n) => {
    const r = preset(n, today);
    return r.from === from && r.to === to;
  });
  const multi = (k: string, label: string, options: Named[]) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`f-${k}`}>{label}</Label>
      <select
        id={`f-${k}`}
        multiple
        size={3}
        className={cn(field, "px-1.5 py-1 md:w-48 md:text-[13px]/[18px]")}
        value={get(k).split(",").filter(Boolean)}
        onChange={(e) => set({ [k]: [...e.target.selectedOptions].map((o) => o.value).join(",") })}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
  const pick = (
    k: string,
    label: string,
    all: string,
    options: { value: string; name: string }[],
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`f-${k}`}>{label}</Label>
      <Select
        id={`f-${k}`}
        size="sm"
        className="md:w-40"
        value={get(k)}
        onChange={(e) => set({ [k]: e.target.value })}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.name}
          </option>
        ))}
      </Select>
    </div>
  );
  // text filters apply on blur or Enter, so typing does not refetch every keystroke
  const text = (k: string, label: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`f-${k}`}>{label}</Label>
      <Input
        id={`f-${k}`}
        key={get(k)}
        defaultValue={get(k)}
        className="md:h-8 md:w-36 md:text-[13px]/[18px]"
        onBlur={(e) => e.target.value.trim() !== get(k) && set({ [k]: e.target.value.trim() })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3 md:sticky md:top-12 md:z-(--z-sticky) md:-mx-6 md:bg-bg md:px-6 md:py-3 xl:-mx-8 xl:px-8">
      <Button
        type="button"
        variant="outline"
        className="md:hidden"
        aria-expanded={open}
        aria-controls="analytics-filters"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal aria-hidden />
        Filters ({count})
      </Button>
      <form
        id="analytics-filters"
        role="search"
        aria-label="Analytics filters"
        className={cn(
          "flex-col gap-3 max-md:rounded-lg max-md:border max-md:border-border max-md:bg-surface max-md:p-4 md:flex md:flex-row md:flex-wrap md:items-end",
          open ? "flex" : "hidden",
        )}
        onSubmit={(e) => e.preventDefault()}
      >
        <div role="group" aria-label="Date range" className="flex flex-wrap items-end gap-2">
          <span className="inline-flex rounded-sm bg-sunken p-0.5">
            {[7, 30, 90].map((n) => (
              <Button
                key={n}
                type="button"
                variant="ghost"
                size="sm"
                className={cn("md:h-7", days === n ? "bg-surface shadow-e1" : "text-fg-muted")}
                aria-pressed={days === n}
                onClick={() => set(preset(n, today))}
              >
                {n} days
              </Button>
            ))}
          </span>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-from">From</Label>
            <Input
              id="f-from"
              type="date"
              className="w-40 md:h-8 md:text-[13px]/[18px]"
              value={from}
              onChange={(e) => set({ from: e.target.value, to: to || today })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="f-to">To</Label>
            <Input
              id="f-to"
              type="date"
              className="w-40 md:h-8 md:text-[13px]/[18px]"
              value={to}
              onChange={(e) => set({ to: e.target.value, from: from || e.target.value })}
            />
          </div>
        </div>
        {pick(
          "tz",
          "Time zone",
          "UTC",
          timezone === "UTC" ? [] : [{ value: timezone, name: timezone }],
        )}
        {multi("campaignIds", "Campaigns", campaigns)}
        {multi("accountIds", "Email accounts", accounts)}
        {text("campaignTag", "Campaign tag")}
        {pick(
          "ownerId",
          "Owner",
          "Any owner",
          members.map((m) => ({ value: m.userId, name: m.name })),
        )}
        {pick("status", "Status", "Any status", [
          { value: "active", name: "Active" },
          { value: "completed", name: "Completed" },
        ])}
        {pick(
          "esp",
          "Recipient ESP",
          "Any ESP",
          ESPS.map((e) => ({ value: e, name: e })),
        )}
        {pick(
          "listId",
          "List",
          "Any list",
          lists.map((l) => ({ value: l.id, name: l.name })),
        )}
        {text("tag", "Lead tag")}
        {count > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start md:self-end"
            onClick={() => set(Object.fromEntries(KEYS.map((k) => [k, ""])))}
          >
            Reset
          </Button>
        )}
      </form>
    </div>
  );
}
