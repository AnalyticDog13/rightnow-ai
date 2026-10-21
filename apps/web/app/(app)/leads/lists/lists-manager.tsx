"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { call, errorText } from "../../accounts/api-client";
import { VERIFICATION } from "../labels";

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
    <div className="flex flex-col gap-3">
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(call("/api/v1/lead-lists", "POST", { name }));
          }}
        >
          <Input
            aria-label="New list name"
            placeholder="New list name"
            className="max-w-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim()}>
            Create list
          </Button>
        </form>
      )}
      {msg && (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      )}
      <Card className="overflow-x-auto p-0">
        <table aria-label="Lead lists" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              {["List", "Leads", "Verification", "Actions"].map((h) => (
                <th key={h} className="p-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lists.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="p-3">
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
                        value={editing.name}
                        onChange={(e) => setEditing({ id: l.id, name: e.target.value })}
                      />
                      <Button type="submit">Save</Button>
                    </form>
                  ) : (
                    <Link href={`/leads?listId=${l.id}`} className="underline">
                      {l.name}
                    </Link>
                  )}
                </td>
                <td className="p-3 tabular-nums">{l.count}</td>
                <td className="p-3 text-xs">
                  {Object.entries(l.stats)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${VERIFICATION[k]}: ${n}`)
                    .join(" · ") || "No leads"}
                </td>
                <td className="p-3">
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        aria-label={`Rename ${l.name}`}
                        onClick={() => setEditing({ id: l.id, name: l.name })}
                      >
                        Rename
                      </Button>
                      {
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs"
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
                          Delete
                        </Button>
                      }
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {lists.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  No lists yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
