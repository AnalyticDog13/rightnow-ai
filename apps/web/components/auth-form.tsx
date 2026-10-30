"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const FIELDS = [
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
];

/** Sign-in form. First-owner sign-up is the onboarding wizard (components/onboarding-wizard.tsx). */
export function AuthForm() {
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
      {FIELDS.map((f) => (
        <div key={f.name} className="flex flex-col gap-1.5">
          <Label htmlFor={f.name}>{f.label}</Label>
          <Input
            className="md:h-11"
            id={f.name}
            name={f.name}
            type={f.type}
            autoComplete={f.autoComplete}
            required
          />
        </div>
      ))}
      <p role="alert" className="min-h-5 text-[13px]/[18px] text-danger">
        {error}
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={busy || !ready}>
        Sign in
      </Button>
    </form>
  );
}
