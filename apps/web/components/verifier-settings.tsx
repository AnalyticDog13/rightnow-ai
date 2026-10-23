"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Props = {
  kind: string;
  url?: string;
  statusPath?: string;
  hasApiKey?: boolean;
  lastError?: { reason: string; at: string | Date | null };
};

/**
 * Email verifier (D38): GET/PUT /settings/verifier. The API key is write-only: the stored one is never shown. The form
 * remounts when the saved values change, so the inputs show what was saved and the key field is empty again.
 */
export function VerifierSettings(v: Props) {
  const [msg, setMsg] = useState("");
  return (
    <VerifierForm
      key={JSON.stringify([v.kind, v.url, v.statusPath, v.hasApiKey])}
      {...v}
      msg={msg}
      setMsg={setMsg}
    />
  );
}

function VerifierForm({
  msg,
  setMsg,
  ...v
}: Props & { msg: string; setMsg: (m: string) => void }) {
  const router = useRouter();
  const [kind, setKind] = useState(v.kind);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const key = String(f.get("apiKey") ?? "");
    const res = await fetch("/api/v1/settings/verifier", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        kind === "http"
          ? {
              kind,
              url: f.get("url"),
              statusPath: f.get("statusPath"),
              ...(key && { apiKey: key }), // empty = keep the stored key
            }
          : { kind },
      ),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setMsg(
      res.ok
        ? "Saved."
        : j.error === "api_key_required"
          ? "Enter the API key: a new host needs its own key."
          : (j.error ?? "Request failed"),
    );
    if (res.ok) router.refresh();
  }

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Email verification</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="verifierKind">Verifier</Label>
          <select
            id="verifierKind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm"
          >
            <option value="mx">Built in (syntax and MX records)</option>
            <option value="http">External service (HTTPS)</option>
          </select>
          <p className="text-xs text-muted-foreground">
            The built-in check never marks an address verified. An external service is paid for by
            you.
          </p>
        </div>
        {kind === "http" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="verifierUrl">Service URL (https)</Label>
              <Input id="verifierUrl" name="url" type="url" defaultValue={v.url} required />
              <p className="text-xs text-muted-foreground">
                Receives a POST with {`{"email": "..."}`} and an Authorization: Bearer header.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="verifierKey">API key</Label>
              <Input
                id="verifierKey"
                name="apiKey"
                type="password"
                autoComplete="off"
                placeholder={v.hasApiKey ? "Stored: leave empty to keep it" : ""}
              />
              <p className="text-xs text-muted-foreground">
                Write-only. Changing the host requires entering the key again.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="verifierPath">
                Response field with the result (e.g. result.status)
              </Label>
              <Input
                id="verifierPath"
                name="statusPath"
                defaultValue={v.statusPath}
                pattern="[A-Za-z0-9_.]{1,64}"
                required
              />
            </div>
          </>
        )}
        {v.lastError && (
          <p role="alert" className="text-sm text-red-700">
            Last verifier error: {v.lastError.reason}
            {v.lastError.at && ` (${new Date(v.lastError.at).toLocaleString()})`}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit">Save verifier</Button>
          <p role="status" className="text-sm">
            {msg}
          </p>
        </div>
      </form>
    </Card>
  );
}
