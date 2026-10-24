"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Field = { name: string; label: string; type?: string; autoComplete?: string };

const FIELDS: Record<"sign-in" | "sign-up", Field[]> = {
  "sign-in": [
    { name: "email", label: "Email", type: "email", autoComplete: "email" },
    { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
  ],
  "sign-up": [
    { name: "name", label: "Your name", autoComplete: "name" },
    { name: "email", label: "Email", type: "email", autoComplete: "email" },
    {
      name: "password",
      label: "Password (12+ characters)",
      type: "password",
      autoComplete: "new-password",
    },
    { name: "workspaceName", label: "Workspace name" },
    { name: "token", label: "Setup token", type: "password", autoComplete: "off" },
  ],
};

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Disabled until hydrated so a native GET submit can never put the password in the URL.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      if (mode === "sign-up") {
        const res = await fetch("/api/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(v),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            error?: string;
            issues?: { message: string }[];
          };
          throw new Error(j.issues?.[0]?.message ?? j.error ?? "Sign-up failed");
        }
      }
      const { data, error: err } = await authClient.signIn.email({
        email: v.email!,
        password: v.password!,
      });
      if (err) throw new Error(err.message ?? "Sign-in failed");
      router.push(
        data && "twoFactorRedirect" in data && data.twoFactorRedirect
          ? "/sign-in/2fa"
          : "/dashboard",
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {FIELDS[mode].map((f) => (
        <div key={f.name} className="flex flex-col gap-1.5">
          <Label htmlFor={f.name}>{f.label}</Label>
          <Input
            id={f.name}
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            required
          />
        </div>
      ))}
      <p role="alert" className="min-h-5 text-sm text-destructive">
        {error}
      </p>
      <Button type="submit" disabled={busy || !ready}>
        {mode === "sign-in" ? "Sign in" : "Create owner account"}
      </Button>
    </form>
  );
}
