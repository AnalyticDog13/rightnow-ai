"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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
  provider_unavailable: "Google is unavailable right now. Please try again in a few minutes.",
  exchange_failed: "Google rejected the sign-in. Please try again.",
  server_error:
    "Something went wrong connecting the account. If you were reconnecting, it may have been deleted.",
};
const KEY = "oauth-session";

type Poll = { status: "pending" | "success" | "error" | "expired"; errorCode?: string };

export function ConnectMenu({
  googleConfigured,
  reconnectAccountId,
}: {
  googleConfigured: boolean;
  /** Reconnect this account instead of connecting a new one. */
  reconnectAccountId?: string;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Every attempt gets a number; a loop whose number is no longer current exits without touching state.
  const attempt = useRef(0);
  const sessionId = useRef<string | null>(null);
  const popup = useRef<Window | null>(null);

  // Polls until a terminal state, the 10 min session expiry, or Cancel. A closed popup is NOT a cancel:
  // Google sends COOP headers that cut the opener link, so popup.closed is unreliable.
  const poll = useCallback(
    async (id: string, mine: number) => {
      setBusy(true);
      for (let i = 0; i < 660 && attempt.current === mine; i++) {
        const res = await fetch(`/api/v1/oauth/sessions/${id}`).catch(() => null);
        if (attempt.current !== mine || res?.status === 404) break;
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
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (attempt.current === mine) {
        sessionStorage.removeItem(KEY);
        setBusy(false);
      }
    },
    [router],
  );

  /** Cancel really cancels: the server session stops accepting the callback, and any old loop exits. */
  function cancel() {
    attempt.current++;
    popup.current?.close();
    discard(sessionId.current);
    sessionId.current = null;
    sessionStorage.removeItem(KEY);
    setBusy(false);
  }
  const discard = (id: string | null) => {
    if (id)
      void fetch(`/api/v1/oauth/sessions/${id}`, { method: "DELETE", keepalive: true }).catch(
        () => {},
      );
  };

  useEffect(() => {
    // Returned from the full-page flow: pick up its result.
    const id = sessionStorage.getItem(KEY);
    if (id) {
      sessionId.current = id;
      void poll(id, ++attempt.current);
    }
  }, [poll]);

  async function connect() {
    setMsg("");
    const mine = ++attempt.current;
    setBusy(true);
    const w = window.open("", "oauth", "popup,width=520,height=680"); // must open inside the click
    const res = await fetch("/api/v1/oauth/google/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reconnectAccountId ? { reconnectAccountId } : {}),
    }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as {
      sessionId?: string;
      authUrl?: string;
      error?: string;
    };
    if (!res?.ok || !j.sessionId || !j.authUrl) {
      w?.close();
      if (attempt.current === mine) {
        setBusy(false);
        setMsg(
          j.error === "not_configured"
            ? "Google is not configured on this server."
            : "Could not start the connection.",
        );
      }
      return;
    }
    if (attempt.current !== mine) {
      // Cancelled while the session was being created.
      w?.close();
      discard(j.sessionId);
      return;
    }
    sessionId.current = j.sessionId;
    if (w) {
      popup.current = w;
      w.location.href = j.authUrl;
      void poll(j.sessionId, mine);
    } else {
      sessionStorage.setItem(KEY, j.sessionId); // popup blocked: full-page redirect (the callback page sees this key), finished on return
      location.href = j.authUrl;
    }
  }

  const verb = reconnectAccountId ? "Reconnect" : "Connect";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button onClick={connect} disabled={busy || !googleConfigured}>
          {busy ? "Waiting for Google..." : `${verb} Google`}
        </Button>
        {busy && (
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
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
