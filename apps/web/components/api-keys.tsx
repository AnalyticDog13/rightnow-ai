"use client";

import { useRouter } from "next/navigation";
import { Copy, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Callout } from "./callout";
import { chipClass } from "./overlay";
import { StatusPill } from "./status-pill";
import { TableEmpty, TableFrame } from "./table-kit";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Key = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : "Never");

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  const j = (await res.json().catch(() => ({}))) as { error?: string; token?: string };
  if (!res.ok) throw new Error(j.error ?? "Request failed");
  return j;
}

export function ApiKeys({ keys, scopes }: { keys: Key[]; scopes: string[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const j = await call("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: f.get("name"), scopes: f.getAll("scope") }),
      });
      setToken(j.token ?? "");
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  async function revoke(k: Key) {
    if (!confirm(`Revoke "${k.name}"? Anything using it stops working immediately.`)) return;
    setError("");
    try {
      await call(`/api/v1/api-keys/${k.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:max-w-240">
      <p role="alert" className="text-[13px]/[18px] text-danger empty:hidden">
        {error}
      </p>
      {token && (
        <Card role="status" className="flex flex-col gap-3">
          <p className="text-sm font-medium">Copy this key now. It is shown only once.</p>
          <div className="flex flex-wrap items-start gap-2">
            <code
              className="min-w-0 flex-1 rounded-md border border-border bg-sunken px-3 py-2 font-mono text-[13px] break-all"
              data-testid="new-token"
            >
              {token}
            </code>
            <Button
              variant="outline"
              onClick={() => void navigator.clipboard?.writeText(token).then(() => setCopied(true))}
            >
              <Copy aria-hidden />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Callout tone="warning">
            It will not be shown again. Store it in a password manager.
          </Callout>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              setToken("");
              setCopied(false);
            }}
          >
            I have copied it
          </Button>
        </Card>
      )}
      <Card>
        <form onSubmit={create} className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Create a key</h2>
          <div className="flex flex-col gap-1.5 sm:max-w-sm">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" maxLength={100} required />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px]/[18px] font-medium">Scopes</legend>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md border border-border p-3 font-mono text-[13px] sm:grid-cols-2 lg:grid-cols-3">
              {scopes.map((s) => (
                <label key={s} className="flex min-h-11 items-center gap-2 md:min-h-7">
                  <input type="checkbox" name="scope" value={s} /> {s}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" className="self-end">
            <KeyRound aria-hidden />
            Create key
          </Button>
        </form>
      </Card>
      <TableFrame>
        <table aria-label="API keys">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" className="hidden md:table-cell">
                Scopes
              </th>
              <th scope="col" className="hidden md:table-cell">
                Created
              </th>
              <th scope="col" className="hidden md:table-cell">
                Last used
              </th>
              <th scope="col">Status</th>
              <th scope="col" className="text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={k.revokedAt ? "[&>td]:text-fg-muted" : undefined}>
                <td className="py-2">
                  <div className="font-medium">{k.name}</div>
                  <div className="font-mono text-xs text-fg-subtle">rn_{k.prefix}</div>
                </td>
                <td className="hidden max-w-72 md:table-cell">
                  <span className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <span key={s} className={chipClass}>
                        {s}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap md:table-cell">{fmt(k.createdAt)}</td>
                <td className="hidden whitespace-nowrap md:table-cell">{fmt(k.lastUsedAt)}</td>
                <td className="whitespace-nowrap text-[13px]/[18px]">
                  {k.revokedAt ? (
                    <>
                      <StatusPill tone="neutral" outline>
                        Revoked
                      </StatusPill>{" "}
                      {fmt(k.revokedAt)}
                    </>
                  ) : (
                    <StatusPill tone="success">Active</StatusPill>
                  )}
                </td>
                <td className="text-right">
                  {!k.revokedAt && (
                    <Button variant="danger-ghost" size="sm" onClick={() => revoke(k)}>
                      Revoke<span className="sr-only"> {k.name}</span>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <TableEmpty
                colSpan={6}
                icon={KeyRound}
                title="No API keys yet."
                body="Create one to use the REST API or connect another tool."
              />
            )}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
