"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** Second step of sign-in: a code from the authenticator app, or one of the backup codes (each works once). */
export function TwoFactorForm() {
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    const { error: err } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    if (err) {
      setError(err.message ?? "That code did not work");
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">{backup ? "Backup code" : "Authentication code"}</Label>
        <Input
          className={
            backup ? "font-mono md:h-11" : "font-mono text-xl tracking-[0.3em] md:h-11 md:text-xl"
          }
          id="code"
          name="code"
          key={String(backup)}
          autoComplete="one-time-code"
          inputMode={backup ? "text" : "numeric"}
          maxLength={backup ? undefined : 6}
          required
        />
      </div>
      <p role="alert" className="min-h-5 text-[13px]/[18px] text-danger">
        {error}
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={busy || !ready}>
        Verify
      </Button>
      <button
        type="button"
        className="self-center text-[13px]/[18px] text-signal underline underline-offset-2"
        onClick={() => {
          setBackup(!backup);
          setError("");
        }}
      >
        {backup ? "Use an authenticator code" : "Use a backup code"}
      </button>
    </form>
  );
}
