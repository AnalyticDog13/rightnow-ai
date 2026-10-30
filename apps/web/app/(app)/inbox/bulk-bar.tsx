"use client";

import { BulkToolbar } from "../../../components/table-kit";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { INTEREST } from "../leads/labels";

type Action = "read" | "unread" | "delete" | "blocklist" | "set_interest";

/** B4.20: replaces the search row of the list pane while conversations are checked. */
export function BulkBar({
  count,
  onClear,
  onAction,
}: {
  count: number;
  onClear: () => void;
  onAction: (action: Action, interestStatus?: number | null) => void;
}) {
  return (
    <div className="border-b border-border p-2">
      <BulkToolbar count={count} onClear={onClear}>
        <Button variant="ghost" size="sm" onClick={() => onAction("read")}>
          Mark read
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAction("unread")}>
          Mark unread
        </Button>
        <Select
          size="sm"
          aria-label="Set lead status"
          value=""
          onChange={(e) => e.target.value && onAction("set_interest", Number(e.target.value))}
        >
          <option value="">Set lead status</option>
          {Object.entries(INTEREST).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" onClick={() => onAction("blocklist")}>
          Block senders
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onAction("delete")}>
          Delete
        </Button>
      </BulkToolbar>
    </div>
  );
}
