"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";
import { SettingsCard } from "./settings-row";
import { StatusPill } from "./status-pill";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Setup = { key: string; uri: string; backupCodes: string[] };

/**
 * D50 two-factor setup: password check, then the key (and an otpauth link; shortcut: no QR image, add one if users ask)
 * and 10 backup codes shown once. 2FA is on only after the first code from the app is proven.
 */
export function SecuritySettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [msg, setMsg] = useState("");

  async function enable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("");
    const password = String(new FormData(e.currentTarget).get("password"));
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || data?.method !== "totp") return setMsg(error?.message ?? "Could not start setup");
    setSetup({
      key: new URL(data.totpURI).searchParams.get("secret") ?? "",
      uri: data.totpURI,
      backupCodes: data.backupCodes ?? [],
    });
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("");
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return setMsg(error.message ?? "That code did not work");
    setSetup(null);
    router.refresh();
  }

  async function disable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("");
    const password = String(new FormData(e.currentTarget).get("password"));
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) return setMsg(error.message ?? "Could not turn off two-factor");
    router.refresh();
  }

  return (
    <SettingsCard
      id="security"
      title="Security"
      status={
        <StatusPill tone={enabled ? "success" : "warning"}>
          {enabled ? "Two-factor on" : "Two-factor off"}
        </StatusPill>
      }
    >
      {setup ? (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <p className="text-sm">
            Add this key to your authenticator app, then enter the 6-digit code it shows.
          </p>
          <div className="flex flex-col gap-2 rounded-md border border-border bg-sunken p-3">
            <span className="micro text-fg-muted">Key</span>
            <code data-testid="totp-key" className="font-mono text-[13px] break-all">
              {setup.key}
            </code>
            <a
              className="self-start text-sm text-signal underline underline-offset-2"
              href={setup.uri}
            >
              Open in authenticator
            </a>
          </div>
          <div>
            <p className="text-[13px]/[18px] font-medium">
              Backup codes (shown once; each works one time)
            </p>
            <ul
              data-testid="backup-codes"
              className="mt-2 grid grid-cols-2 gap-1 rounded-md border border-border p-3 font-mono text-[13px] sm:grid-cols-5"
            >
              {setup.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5 sm:max-w-60">
            <Label htmlFor="totp-code">Code from the app</Label>
            <Input
              className="font-mono"
              id="totp-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </div>
          <div>
            <Button type="submit">Turn on two-factor</Button>
          </div>
        </form>
      ) : (
        <form onSubmit={enabled ? disable : enable} className="flex flex-col gap-4">
          <p className="text-[13px]/[18px] text-fg-muted">
            {enabled
              ? "Two-factor authentication is on: sign-in asks for a code from your authenticator app."
              : "Protect your account with a code from an authenticator app at sign-in."}
          </p>
          <div className="flex flex-col gap-1.5 sm:max-w-80">
            <Label htmlFor="security-password">Your password</Label>
            <Input
              id="security-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <Button type="submit" variant={enabled ? "outline" : "default"}>
              {enabled ? "Turn off two-factor" : "Set up two-factor"}
            </Button>
          </div>
        </form>
      )}
      <p role="status" className="text-[13px]/[18px] text-danger empty:hidden">
        {msg}
      </p>
    </SettingsCard>
  );
}
