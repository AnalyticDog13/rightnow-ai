"use client";

import { ListPlus, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Callout } from "../../../../components/callout";
import { PageHeader } from "../../../../components/page-header";
import { SectionTabs } from "../../../../components/section-tabs";
import { TableEmpty, TableFrame } from "../../../../components/table-kit";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { call, errorText } from "../../accounts/api-client";
import { LEAD_TABS, VERIFICATION } from "../labels";

// B5.9 status bar: verified / risky / invalid in success / warning / danger, everything else neutral
const SEGMENTS: [string, string[]][] = [
  ["bg-success-solid", ["VERIFIED"]],
  ["bg-warning-solid", ["RISKY", "CATCH_ALL", "JOB_CHANGE"]],
  ["bg-danger-solid", ["INVALID"]],
  ["bg-neutral-solid", ["NOT_VERIFIED", "PENDING", "PENDING_JOB"]],
];

type Row = { id: string; name: string; count: number; stats: Record<string, number> };

export function ListsManager({ lists, canEdit }: { lists: Row[]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [msg, setMsg] = useState("");

  async function act(r: ReturnType<typeof call>) {
    const res = await r;
    setMsg(res.ok ? "" : errorText(res));
    if (res.ok) {
      setName("");
      setEditing(null);
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lead Lists"
        description="Named groups of leads you can enroll in campaigns."
        tabs={<SectionTabs tabs={LEAD_TABS} />}
        actions={
          canEdit && (
            <form
              className="flex w-full gap-2 md:w-auto"
              onSubmit={(e) => {
                e.preventDefault();
                void act(call("/api/v1/lead-lists", "POST", { name }));
              }}
            >
              <Input
                aria-label="New list name"
                placeholder="New list name"
                className="md:w-56"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" disabled={!name.trim()}>
                <Plus aria-hidden />
                Create list
              </Button>
            </form>
          )
        }
      />
      {msg && (
        <Callout tone="danger" role="alert">
          {msg}
        </Callout>
      )}
      <TableFrame>
        <table aria-label="Lead lists">
          <thead>
            <tr>
              <th scope="col">List</th>
              <th scope="col" className="text-right">
                Leads
              </th>
              <th scope="col" className="hidden md:table-cell">
                Verification
              </th>
              <th scope="col" className="text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {lists.map((l) => {
              const parts = Object.entries(l.stats).filter(([, n]) => n > 0);
              const summary =
                parts.map(([k, n]) => `${VERIFICATION[k]}: ${n}`).join(" · ") || "No leads";
              const sum = parts.reduce((a, [, n]) => a + n, 0);
              return (
                <tr key={l.id}>
                  <td className="max-w-72">
                    {editing?.id === l.id ? (
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act(
                            call(`/api/v1/lead-lists/${l.id}`, "PATCH", { name: editing.name }),
                          );
                        }}
                      >
                        <Input
                          aria-label={`New name for ${l.name}`}
                          className="md:h-8"
                          value={editing.name}
                          onChange={(e) => setEditing({ id: l.id, name: e.target.value })}
                        />
                        <Button type="submit" size="sm">
                          Save
                        </Button>
                      </form>
                    ) : (
                      <Link
                        href={`/leads?listId=${l.id}`}
                        className="block truncate font-medium text-signal underline-offset-2 hover:underline"
                      >
                        {l.name}
                      </Link>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{l.count}</td>
                  <td className="hidden md:table-cell">
                    {sum > 0 ? (
                      <span className="flex items-center gap-3">
                        <span
                          aria-hidden
                          title={summary}
                          className="flex h-1.5 w-32 overflow-hidden rounded-xs bg-sunken"
                        >
                          {SEGMENTS.map(([cls, keys]) => {
                            const n = parts
                              .filter(([k]) => keys.includes(k))
                              .reduce((a, [, x]) => a + x, 0);
                            return n ? (
                              <span
                                key={cls}
                                className={cls}
                                style={{ width: `${(n / sum) * 100}%` }}
                              />
                            ) : null;
                          })}
                        </span>
                        <span className="truncate text-[13px]/[18px] text-fg-muted">{summary}</span>
                      </span>
                    ) : (
                      <span className="text-[13px]/[18px] text-fg-subtle">No leads</span>
                    )}
                  </td>
                  <td>
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Rename ${l.name}`}
                          onClick={() => setEditing({ id: l.id, name: l.name })}
                        >
                          <Pencil aria-hidden />
                          <span className="max-md:sr-only">Rename</span>
                        </Button>
                        <Button
                          variant="danger-ghost"
                          size="sm"
                          aria-label={`Delete ${l.name}`}
                          onClick={() => {
                            if (
                              confirm(
                                `Delete the list "${l.name}"? Its ${l.count} lead(s) are kept.`,
                              )
                            )
                              void act(call(`/api/v1/lead-lists/${l.id}`, "DELETE"));
                          }}
                        >
                          <Trash2 aria-hidden />
                          <span className="max-md:sr-only">Delete</span>
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {lists.length === 0 && (
              <TableEmpty
                colSpan={4}
                icon={ListPlus}
                title="No lead lists yet."
                body="Lists group leads for enrollment. Create one, then add leads from the Leads table or an import."
              />
            )}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
