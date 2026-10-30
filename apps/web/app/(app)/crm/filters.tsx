"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SearchInput } from "../../../components/table-kit";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import type { Member, Named } from "../leads/bulk-bar";

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
    <Select size="sm" aria-label={label} value={get(k)} onChange={(e) => set(k, e.target.value)}>
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.name}
        </option>
      ))}
    </Select>
  );

  return (
    <form
      role="search"
      aria-label="Filter opportunities"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => e.preventDefault()}
    >
      <SearchInput
        aria-label="Search opportunities"
        placeholder="Search email or domain"
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
      <span className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px]/[18px] text-fg-muted">
          Created from
          <Input
            type="date"
            className="w-40 md:h-8"
            value={get("from")}
            onChange={(e) => set("from", e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-[13px]/[18px] text-fg-muted">
          to
          <Input
            type="date"
            className="w-40 md:h-8"
            value={get("to")}
            onChange={(e) => set("to", e.target.value)}
          />
        </label>
      </span>
    </form>
  );
}
