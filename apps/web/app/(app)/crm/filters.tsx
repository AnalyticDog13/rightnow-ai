"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Input } from "../../../components/ui/input";
import type { Member, Named } from "../leads/bulk-bar";

const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";

/** Board filters live in the URL query, so a reload or a shared link keeps them. */
export function Filters({
  campaigns,
  lists,
  members,
  stages,
}: {
  campaigns: Named[];
  lists: Named[];
  members: Member[];
  stages: Named[];
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const [q, setQ] = useState(get("q"));

  function set(k: string, v: string) {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${path}?${p}`, { scroll: false });
  }

  // the search box waits for a pause in typing before it changes the URL
  useEffect(() => {
    if (q === get("q")) return;
    const t = setTimeout(() => set("q", q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (
    k: string,
    label: string,
    all: string,
    options: { value: string; name: string }[],
  ) => (
    <select
      aria-label={label}
      className={sel}
      value={get(k)}
      onChange={(e) => set(k, e.target.value)}
    >
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.name}
        </option>
      ))}
    </select>
  );

  return (
    <form
      role="search"
      aria-label="Filter opportunities"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => e.preventDefault()}
    >
      <Input
        type="search"
        aria-label="Search opportunities"
        placeholder="Search email or domain"
        className="max-w-xs"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {pick(
        "campaignId",
        "Filter by campaign",
        "All campaigns",
        campaigns.map((c) => ({ value: c.id, name: c.name })),
      )}
      {pick(
        "listId",
        "Filter by list",
        "All lists",
        lists.map((c) => ({ value: c.id, name: c.name })),
      )}
      {pick(
        "ownerId",
        "Filter by owner",
        "Any owner",
        members.map((m) => ({ value: m.userId, name: m.name })),
      )}
      {pick(
        "stageId",
        "Filter by stage",
        "All stages",
        stages.map((s) => ({ value: s.id, name: s.name })),
      )}
      <label className="flex items-center gap-1 text-sm">
        Created from
        <Input
          type="date"
          className="w-40"
          value={get("from")}
          onChange={(e) => set("from", e.target.value)}
        />
      </label>
      <label className="flex items-center gap-1 text-sm">
        to
        <Input
          type="date"
          className="w-40"
          value={get("to")}
          onChange={(e) => set("to", e.target.value)}
        />
      </label>
    </form>
  );
}
