"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { Member, Named } from "../leads/bulk-bar";
import { preset } from "./query";

const sel = "rounded-md border border-border bg-card px-3 text-sm";
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
        className={sel}
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
      <select
        id={`f-${k}`}
        className={`h-10 ${sel}`}
        value={get(k)}
        onChange={(e) => set({ [k]: e.target.value })}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.name}
          </option>
        ))}
      </select>
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
        className="w-36"
        onBlur={(e) => e.target.value.trim() !== get(k) && set({ [k]: e.target.value.trim() })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  );

  return (
    <form
      role="search"
      aria-label="Analytics filters"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => e.preventDefault()}
    >
      <div role="group" aria-label="Date range" className="flex flex-wrap items-end gap-2">
        {[7, 30, 90].map((n) => (
          <Button
            key={n}
            type="button"
            variant={days === n ? "default" : "outline"}
            aria-pressed={days === n}
            onClick={() => set(preset(n, today))}
          >
            {n} days
          </Button>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-from">From</Label>
          <Input
            id="f-from"
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => set({ from: e.target.value, to: to || today })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-to">To</Label>
          <Input
            id="f-to"
            type="date"
            className="w-40"
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
    </form>
  );
}
