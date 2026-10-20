"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
      <p role="alert" className="min-h-5 text-sm text-destructive">
        {error}
      </p>
      {token && (
        <Card role="status" className="flex flex-col gap-2">
          <p className="text-sm font-medium">Copy this key now. It is shown only once.</p>
          <code className="break-all rounded-md bg-muted p-2 text-sm" data-testid="new-token">
            {token}
          </code>
          <Button variant="outline" className="self-start" onClick={() => setToken("")}>
            I have copied it
          </Button>
        </Card>
      )}
      <Card>
        <form onSubmit={create} className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Create a key</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" maxLength={100} required />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Scopes</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {scopes.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="scope" value={s} /> {s}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" className="self-start">
            Create key
          </Button>
        </form>
      </Card>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              {["Name", "Prefix", "Scopes", "Created", "Last used", "Status", ""].map((h, i) => (
                <th key={i} className="p-2 font-medium">
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-border">
                <td className="p-2">{k.name}</td>
                <td className="p-2 font-mono">rn_{k.prefix}</td>
                <td className="p-2">{k.scopes.join(", ")}</td>
                <td className="p-2">{fmt(k.createdAt)}</td>
                <td className="p-2">{fmt(k.lastUsedAt)}</td>
                <td className="p-2">{k.revokedAt ? `Revoked ${fmt(k.revokedAt)}` : "Active"}</td>
                <td className="p-2">
                  {!k.revokedAt && (
                    <Button variant="outline" onClick={() => revoke(k)}>
                      Revoke<span className="sr-only"> {k.name}</span>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-muted-foreground">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
