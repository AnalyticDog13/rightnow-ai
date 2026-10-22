"use client";

import { Button } from "../../../components/ui/button";
import { INTEREST } from "../leads/labels";

type Action = "read" | "unread" | "delete" | "blocklist" | "set_interest";

export function BulkBar({
  count,
  onAction,
}: {
  count: number;
  onAction: (action: Action, interestStatus?: number | null) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 text-sm"
    >
      <span>{count} selected</span>
      <Button variant="outline" onClick={() => onAction("read")}>
        Mark read
      </Button>
      <Button variant="outline" onClick={() => onAction("unread")}>
        Mark unread
      </Button>
      <select
        aria-label="Set lead status"
        value=""
        className="h-10 rounded-md border border-border bg-card px-3 text-sm"
        onChange={(e) => e.target.value && onAction("set_interest", Number(e.target.value))}
      >
        <option value="">Set lead status</option>
        {Object.entries(INTEREST).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <Button variant="outline" onClick={() => onAction("blocklist")}>
        Block senders
      </Button>
      <Button variant="outline" onClick={() => onAction("delete")}>
        Delete
      </Button>
    </div>
  );
}
