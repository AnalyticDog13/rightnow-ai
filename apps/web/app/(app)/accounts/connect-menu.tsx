"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";

const MESSAGES: Record<string, string> = {
  account_exists: "That mailbox is already connected.",
  email_mismatch: "You signed in with a different Google account than the one being reconnected.",
  state_invalid: "That connection attempt is no longer valid. Please try again.",
  expired: "The connection attempt expired. Please try again.",
  access_denied: "Google access was not granted.",
  scope_missing: "Both Gmail permissions are required. Please try again and tick every box.",
  no_refresh_token:
    "Google did not return a refresh token. Remove the app at myaccount.google.com/permissions, then try again.",
  exchange_failed: "Google rejected the sign-in. Please try again.",
  server_error:
    "Something went wrong connecting the account. If you were reconnecting, it may have been deleted.",
};
const KEY = "oauth-session";

type Poll = { status: "pending" | "success" | "error" | "expired"; errorCode?: string };

export function ConnectMenu({ googleConfigured }: { googleConfigured: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const poll = useCallback(
    async (id: string, popup: Window | null) => {
      setBusy(true);
      sessionStorage.setItem(KEY, id);
      let closedPolls = 0;
      for (let i = 0; i < 700; i++) {
        const res = await fetch(`/api/v1/oauth/sessions/${id}`).catch(() => null);
        if (res?.status === 404) break;
        const r = res?.ok ? ((await res.json()) as Poll) : null;
        if (r && r.status !== "pending") {
          sessionStorage.removeItem(KEY);
          setBusy(false);
          if (r.status === "success") {
            setMsg("");
            router.refresh();
          } else setMsg(MESSAGES[r.errorCode ?? "server_error"] ?? MESSAGES.server_error!);
          return;
        }
        // The callback finishes before the popup closes, so a closed popup + still pending = cancelled.
        if (popup?.closed && ++closedPolls > 1) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      sessionStorage.removeItem(KEY);
      setBusy(false);
    },
    [router],
  );

  useEffect(() => {
    // Returned from the full-page flow: pick up its result.
    const id = sessionStorage.getItem(KEY);
    if (id) void poll(id, null);
  }, [poll]);

  async function connect() {
    setMsg("");
    const popup = window.open("", "oauth", "popup,width=520,height=680"); // must open inside the click
    const res = await fetch("/api/v1/oauth/google/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const j = (await res.json().catch(() => ({}))) as {
      sessionId?: string;
      authUrl?: string;
      error?: string;
    };
    if (!res.ok || !j.sessionId || !j.authUrl) {
      popup?.close();
      setMsg(
        j.error === "not_configured"
          ? "Google is not configured on this server."
          : "Could not start the connection.",
      );
      return;
    }
    if (popup) {
      popup.location.href = j.authUrl;
      void poll(j.sessionId, popup);
    } else {
      sessionStorage.setItem(KEY, j.sessionId); // popup blocked: full-page redirect, finished on return
      location.href = j.authUrl;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button className="self-start" onClick={connect} disabled={busy || !googleConfigured}>
        {busy ? "Waiting for Google..." : "Connect Google"}
      </Button>
      {!googleConfigured && (
        <p className="text-sm text-muted-foreground">
          Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see
          docs/ops/GOOGLE_SETUP.md).
        </p>
      )}
      <p role="alert" className="min-h-5 text-sm text-destructive">
        {msg}
      </p>
    </div>
  );
}
