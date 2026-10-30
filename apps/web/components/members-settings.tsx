"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Callout } from "./callout";
import { SettingsCard } from "./settings-row";
import { StatusPill } from "./status-pill";
import { TableFrame } from "./table-kit";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";

type Member = { id: string; name: string; email: string; role: string; self: boolean };
type Invite = { id: string; email: string; role: string | null; expiresAt: string };

const ROLES = ["admin", "member", "viewer"];

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
  if (!res.ok) throw new Error(j.error ?? "Request failed");
  return j;
}

/** D50: invite by link (no email is sent), change roles, remove members. The OWNER is fixed. ADMIN-only. */
export function MembersSettings({ members, invites }: { members: Member[]; invites: Invite[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [link, setLink] = useState("");

  const run = (fn: () => Promise<unknown>) => async () => {
    setMsg("");
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("");
    setLink("");
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const j = await call("/api/v1/invites", "POST", {
        email: f.get("email"),
        role: f.get("role"),
      });
      setLink(`${window.location.origin}/invite/${j.id}`);
      form.reset();
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <SettingsCard id="members" title="Members">
      <TableFrame>
        <table aria-label="Members">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col" className="text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td className="max-w-64 py-2">
                  <div className="truncate font-medium">
                    {m.name}
                    {m.self && <span className="font-normal text-fg-subtle"> (you)</span>}
                  </div>
                  <div className="truncate text-[13px]/[18px] text-fg-subtle">{m.email}</div>
                </td>
                <td>
                  {m.role === "owner" ? (
                    <StatusPill tone="neutral">owner</StatusPill>
                  ) : (
                    <Select
                      size="sm"
                      aria-label={`Role of ${m.email}`}
                      value={m.role}
                      onChange={(e) =>
                        void run(() =>
                          call(`/api/v1/members/${m.id}`, "PATCH", { role: e.target.value }),
                        )()
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </Select>
                  )}
                </td>
                <td className="text-right">
                  {m.role !== "owner" && !m.self && (
                    <Button
                      variant="danger-ghost"
                      size="sm"
                      aria-label={`Remove ${m.email}`}
                      onClick={() => {
                        if (
                          confirm(
                            `Remove ${m.email}? They lose access and their API keys are revoked.`,
                          )
                        )
                          void run(() => call(`/api/v1/members/${m.id}`, "DELETE"))();
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>

      <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="invite-to">Invite by email</Label>
          <Input id="invite-to" name="email" type="email" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Select id="invite-role" name="role" defaultValue="member">
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          Create invite link
        </Button>
      </form>
      {link && (
        <Callout tone="info" title="Invite link created">
          Send this link to the new member (valid for 7 days; no email is sent):{" "}
          <code data-testid="invite-link" className="font-mono break-all">
            {link}
          </code>
        </Callout>
      )}
      {invites.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="micro text-fg-muted">Pending invites</h3>
          <ul
            aria-label="Pending invites"
            className="flex flex-col divide-y divide-border rounded-md border border-border"
          >
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-3 py-1.5 pr-2 pl-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium break-all">{i.email}</span> as {i.role}{" "}
                  <span className="text-fg-subtle">
                    (expires {new Date(i.expiresAt).toLocaleDateString()})
                  </span>
                </span>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  aria-label={`Cancel invite for ${i.email}`}
                  onClick={() => void run(() => call(`/api/v1/invites/${i.id}`, "DELETE"))()}
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p role="status" className="text-[13px]/[18px] text-danger empty:hidden">
        {msg}
      </p>
    </SettingsCard>
  );
}
