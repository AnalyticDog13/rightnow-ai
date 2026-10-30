"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SettingRow, SettingsCard } from "./settings-row";
import { StatusPill } from "./status-pill";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

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
  const [classify, setClassify] = useState(!!s.classifierEnabled);

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
    <SettingsCard
      key={JSON.stringify(s)}
      id="ai"
      title="AI"
      status={
        s.hasApiKey ? (
          <StatusPill tone="success">Key saved</StatusPill>
        ) : (
          <StatusPill tone="neutral">No key</StatusPill>
        )
      }
      description="Any OpenAI-compatible endpoint (hosted, or a local server). AI never sends anything: its text waits for your approval. Usage is billed by your provider."
    >
      <form onSubmit={save} className="flex flex-col">
        <SettingRow htmlFor="aiBaseUrl" label="AI base URL">
          <Input
            id="aiBaseUrl"
            name="baseUrl"
            type="url"
            className="font-mono md:text-[13px]"
            defaultValue={s.baseUrl}
            placeholder="https://api.openai.com/v1"
            required
          />
        </SettingRow>
        <SettingRow htmlFor="aiModel" label="AI model">
          <Input id="aiModel" name="model" defaultValue={s.model} required />
        </SettingRow>
        <SettingRow
          htmlFor="aiKey"
          label="AI provider key"
          helper="Write-only. Changing the host requires entering the key again."
        >
          <Input
            id="aiKey"
            name="apiKey"
            type="password"
            autoComplete="off"
            aria-describedby="aiKey-help"
            placeholder={s.hasApiKey ? "Stored: leave empty to keep it" : ""}
          />
        </SettingRow>
        <SettingRow label="Prices (USD per 1M tokens)">
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
        </SettingRow>
        <SettingRow label="Reply classifier">
          <Switch
            name="classifierEnabled"
            label="Use AI for uncertain replies"
            checked={classify}
            onChange={(e) => setClassify(e.target.checked)}
          />
        </SettingRow>
        <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
          <p role="status" className="mr-auto text-[13px]/[18px]">
            {msg}
          </p>
          <Button type="submit">Save AI settings</Button>
        </div>
      </form>
    </SettingsCard>
  );
}
