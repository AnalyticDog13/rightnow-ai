"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { call, errorText } from "../accounts/api-client";
import { StatusBadge } from "./status-badge";

type Row = {
  id: string;
  name: string;
  status: string;
  total: number;
  completed: number;
  sentToday: number;
};
const RESUMABLE = ["Paused", "Bounce Protect", "Accounts Unhealthy", "Completed"];

export function CampaignsTable({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  async function create() {
    const r = await call("/api/v1/campaigns", "POST", { name });
    if (!r.ok) return setMsg(errorText(r));
    router.push(`/campaigns/${(r.json as { id: string }).id}`);
  }
  async function act(r: Row, verb: "pause" | "resume" | "archive") {
    const res = await call(
      `/api/v1/campaigns/${r.id}/${verb}`,
      "POST",
      verb === "resume" ? {} : undefined,
    );
    setMsg(res.ok ? "" : `${r.name}: ${errorText(res)}`);
    router.refresh();
  }
  const btn = (r: Row, verb: "pause" | "resume" | "archive", label: string) => (
    <Button
      variant="outline"
      className="h-8 px-2 text-xs"
      aria-label={`${label} ${r.name}`}
      onClick={() => void act(r, verb)}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input
            aria-label="New campaign name"
            placeholder="New campaign name"
            className="max-w-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim()}>
            Create campaign
          </Button>
        </form>
      )}
      {msg && (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      )}
      <Card className="overflow-x-auto p-0">
        <table aria-label="Campaigns" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              {["Campaign", "Status", "Finished", "Sent today", "Actions"].map((h) => (
                <th key={h} className="p-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border">
                <td className="p-3">
                  <Link href={`/campaigns/${r.id}`} className="underline">
                    {r.name}
                  </Link>
                </td>
                <td className="p-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="p-3 tabular-nums">
                  {r.completed} / {r.total} leads
                </td>
                <td className="p-3 tabular-nums">{r.sentToday}</td>
                <td className="p-3">
                  {canEdit && (
                    <div className="flex gap-1">
                      {r.status === "Active" && btn(r, "pause", "Pause")}
                      {RESUMABLE.includes(r.status) && btn(r, "resume", "Resume")}
                      {r.status !== "Archived" && btn(r, "archive", "Archive")}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No campaigns yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
