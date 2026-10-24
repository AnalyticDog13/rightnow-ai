"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
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
    <Card id="security" className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Security</h2>
      {setup ? (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <p className="text-sm">
            Add this key to your authenticator app, then enter the 6-digit code it shows.
          </p>
          <p className="text-sm">
            Key: <code data-testid="totp-key">{setup.key}</code>{" "}
            <a className="text-primary underline" href={setup.uri}>
              Open in authenticator
            </a>
          </p>
          <div>
            <p className="text-sm font-medium">Backup codes (shown once; each works one time)</p>
            <ul
              data-testid="backup-codes"
              className="mt-1 grid grid-cols-2 gap-1 font-mono text-sm"
            >
              {setup.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="totp-code">Code from the app</Label>
            <Input
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
          <p className="text-sm text-muted-foreground">
            {enabled
              ? "Two-factor authentication is on: sign-in asks for a code from your authenticator app."
              : "Protect your account with a code from an authenticator app at sign-in."}
          </p>
          <div className="flex flex-col gap-1.5">
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
      <p role="status" className="min-h-5 text-sm">
        {msg}
      </p>
    </Card>
  );
}
