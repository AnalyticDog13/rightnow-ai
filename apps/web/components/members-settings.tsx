"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
    <Card id="members" className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Members</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-medium">Name</th>
            <th className="py-1 font-medium">Email</th>
            <th className="py-1 font-medium">Role</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-t border-border">
              <td className="py-1.5">{m.name}</td>
              <td className="py-1.5">{m.email}</td>
              <td className="py-1.5">
                {m.role === "owner" ? (
                  "owner"
                ) : (
                  <select
                    aria-label={`Role of ${m.email}`}
                    value={m.role}
                    onChange={(e) =>
                      void run(() =>
                        call(`/api/v1/members/${m.id}`, "PATCH", { role: e.target.value }),
                      )()
                    }
                    className="h-8 rounded-md border border-border bg-card px-2 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                )}
              </td>
              <td className="py-1.5 text-right">
                {m.role !== "owner" && !m.self && (
                  <Button
                    variant="outline"
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

      <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-to">Invite by email</Label>
          <Input id="invite-to" name="email" type="email" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="member"
            className="h-10 rounded-md border border-border bg-card px-3 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <Button type="submit">Create invite link</Button>
      </form>
      {link && (
        <p className="text-sm">
          Send this link to the new member (valid for 7 days; no email is sent):{" "}
          <code data-testid="invite-link" className="break-all">
            {link}
          </code>
        </p>
      )}
      {invites.length > 0 && (
        <ul aria-label="Pending invites" className="flex flex-col gap-1 text-sm">
          {invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3">
              <span>
                {i.email} as {i.role} (expires {new Date(i.expiresAt).toLocaleDateString()})
              </span>
              <Button
                variant="outline"
                aria-label={`Cancel invite for ${i.email}`}
                onClick={() => void run(() => call(`/api/v1/invites/${i.id}`, "DELETE"))()}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="min-h-5 text-sm">
        {msg}
      </p>
    </Card>
  );
}
