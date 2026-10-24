"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const ERRORS: Record<string, string> = {
  invite_used: "This invite was already used or canceled.",
  invite_expired: "This invite has expired. Ask for a new one.",
  user_exists: "An account with this email already exists.",
  invite_not_found: "This invite link is not valid.",
  rate_limited: "Too many attempts. Try again in a few minutes.",
};

/** Accepts the invite, then signs the new member in with the password just chosen. */
export function InviteForm({ invitationId, email }: { invitationId: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const res = await fetch("/api/invite/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invitationId, name: f.name, password: f.password }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: { message: string }[];
      };
      setError(j.issues?.[0]?.message ?? ERRORS[j.error ?? ""] ?? j.error ?? "Request failed");
      setBusy(false);
      return;
    }
    const { error: err } = await authClient.signIn.email({ email, password: f.password! });
    if (err) {
      router.push("/sign-in");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" value={email} readOnly />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password (12+ characters)</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      <p role="alert" className="min-h-5 text-sm text-destructive">
        {error}
      </p>
      <Button type="submit" disabled={busy || !ready}>
        Join workspace
      </Button>
    </form>
  );
}
