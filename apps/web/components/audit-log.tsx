import { listAuditLogs } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import Link from "next/link";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
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
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(logs.flatMap((l) => (l.actorId ? [l.actorId] : [])))] } },
    select: { id: true, email: true },
  });
  const who = new Map(users.map((u) => [u.id, u.email]));
  return (
    <Card id="audit" className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Audit log</h2>
      <form method="get" action="/settings#audit" className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-action">Action starts with</Label>
          <Input id="audit-action" name="action" defaultValue={action} placeholder="auth." />
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-medium">Time</th>
            <th className="py-1 font-medium">Who</th>
            <th className="py-1 font-medium">Action</th>
            <th className="py-1 font-medium">Target</th>
            <th className="py-1 font-medium">Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} className="border-t border-border align-top">
              <td className="py-1.5 whitespace-nowrap">{l.createdAt.toLocaleString()}</td>
              <td className="py-1.5">{(l.actorId && who.get(l.actorId)) || "system"}</td>
              <td className="py-1.5 font-mono">{l.action}</td>
              <td className="py-1.5 break-all">{l.target}</td>
              <td className="py-1.5 break-all font-mono text-xs">{show(l.meta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {logs.length === 0 && <p className="text-sm text-muted-foreground">No matching entries.</p>}
      {nextCursor && (
        <Link
          className="text-sm text-primary underline"
          href={`/settings?${new URLSearchParams({ ...(action && { action }), cursor: nextCursor })}#audit`}
        >
          Older entries
        </Link>
      )}
    </Card>
  );
}
