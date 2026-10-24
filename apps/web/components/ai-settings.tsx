"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Props = {
  baseUrl?: string;
  model?: string;
  inputPricePerMTok?: number;
  outputPricePerMTok?: number;
  classifierEnabled?: boolean;
  hasApiKey?: boolean;
};

const ERRORS: Record<string, string> = {
  api_key_required: "Enter the API key: a new host needs its own key.",
  ai_host_not_public:
    "That host is private or not allowed. Set ALLOW_PRIVATE_HTTP_HOSTS=1 for a LAN server.",
  invalid_url: "Enter an http(s) URL without a username or password.",
};

/**
 * AI provider (D47): GET/PUT /settings/ai. Any OpenAI-compatible endpoint. The key is write-only: the stored one is never
 * shown. The form remounts when the saved values change, so the key field is empty again.
 */
export function AiSettings(s: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState("");

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) === "" ? undefined : Number(f.get(k)));
    const key = String(f.get("apiKey") ?? "");
    const res = await fetch("/api/v1/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: f.get("baseUrl"),
        model: f.get("model"),
        ...(key && { apiKey: key }), // empty = keep the stored key
        inputPricePerMTok: num("inputPricePerMTok"),
        outputPricePerMTok: num("outputPricePerMTok"),
        classifierEnabled: f.get("classifierEnabled") === "on",
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setMsg(res.ok ? "Saved." : (ERRORS[j.error ?? ""] ?? j.error ?? "Request failed"));
    if (res.ok) router.refresh();
  }

  return (
    <Card key={JSON.stringify(s)}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">AI</h2>
        <p className="text-xs text-muted-foreground">
          Any OpenAI-compatible endpoint (hosted, or a local server). AI never sends anything: its
          text waits for your approval. Usage is billed by your provider.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="aiBaseUrl">Base URL</Label>
          <Input
            id="aiBaseUrl"
            name="baseUrl"
            type="url"
            defaultValue={s.baseUrl}
            placeholder="https://api.openai.com/v1"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="aiModel">Model</Label>
          <Input id="aiModel" name="model" defaultValue={s.model} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="aiKey">API key</Label>
          <Input
            id="aiKey"
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={s.hasApiKey ? "Stored: leave empty to keep it" : ""}
          />
          <p className="text-xs text-muted-foreground">
            Write-only. Changing the host requires entering the key again.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aiIn">Input price (USD per 1M tokens)</Label>
            <Input
              id="aiIn"
              name="inputPricePerMTok"
              type="number"
              min="0"
              step="any"
              defaultValue={s.inputPricePerMTok}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="aiOut">Output price (USD per 1M tokens)</Label>
            <Input
              id="aiOut"
              name="outputPricePerMTok"
              type="number"
              min="0"
              step="any"
              defaultValue={s.outputPricePerMTok}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="classifierEnabled" defaultChecked={s.classifierEnabled} />
          Use AI for uncertain replies
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit">Save AI settings</Button>
          <p role="status" className="text-sm">
            {msg}
          </p>
        </div>
      </form>
    </Card>
  );
}
