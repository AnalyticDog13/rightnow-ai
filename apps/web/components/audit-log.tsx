import { actorLabels, listAuditLogs } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import Link from "next/link";
import { SettingsCard } from "./settings-row";
import { TableFrame } from "./table-kit";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const SECRET_KEY = /secret|token|password|passwd|key|hash|credential|authorization/i;

/** Audit meta must never hold secrets (PS-SEC-07); anything that looks like one is hidden here as a second line of defence. */
function show(meta: unknown) {
  if (!meta || typeof meta !== "object") return "";
  const safe = Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[hidden]" : v]),
  );
  const s = JSON.stringify(safe);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/** Settings → Audit log: newest first, filtered by action prefix (`?action=webhook.`), paged with `?cursor=`. */
export async function AuditLog({
  workspaceId,
  action,
  cursor,
}: {
  workspaceId: string;
  action?: string;
  cursor?: string;
}) {
  const { logs, nextCursor } = await listAuditLogs(prisma, workspaceId, {
    action: action || undefined,
    cursor,
    take: 50,
  });
  const who = await actorLabels(
    prisma,
    workspaceId,
    logs.map((l) => l.actorId),
  );
  return (
    <SettingsCard id="audit-log" title="Audit log">
      <form method="get" action="/settings#audit-log" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-action">Action starts with</Label>
          <Input
            id="audit-action"
            name="action"
            className="font-mono md:text-[13px]"
            defaultValue={action}
            placeholder="auth."
          />
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <TableFrame>
        <table aria-label="Audit log">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Who</th>
              <th scope="col">Action</th>
              <th scope="col" className="hidden md:table-cell">
                Target
              </th>
              <th scope="col" className="hidden md:table-cell">
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="whitespace-nowrap text-fg-muted tabular-nums">
                  {l.createdAt.toLocaleString()}
                </td>
                <td>{(l.actorId && who.get(l.actorId)) || "system"}</td>
                <td className="font-mono text-[13px]">{l.action}</td>
                <td className="hidden max-w-48 break-all text-fg-muted md:table-cell">
                  {l.target}
                </td>
                <td className="hidden max-w-64 font-mono text-xs break-all text-fg-subtle md:table-cell">
                  {show(l.meta)}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-fg-muted">
                  No matching entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableFrame>
      {nextCursor && (
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link
            href={`/settings?${new URLSearchParams({ ...(action && { action }), cursor: nextCursor })}#audit-log`}
          >
            Next page
          </Link>
        </Button>
      )}
    </SettingsCard>
  );
}
