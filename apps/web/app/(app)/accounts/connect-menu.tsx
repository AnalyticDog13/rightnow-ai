"use client";

import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Callout } from "../../../components/callout";
import { ActionCard } from "../../../components/empty-state";
import { Button } from "../../../components/ui/button";

export type Provider = "google" | "microsoft";
const NAME: Record<Provider, string> = { google: "Google", microsoft: "Microsoft" };

const MESSAGES: Record<string, string> = {
  account_exists: "That mailbox is already connected.",
  email_mismatch: "You signed in with a different account than the one being reconnected.",
  state_invalid: "That connection attempt is no longer valid. Please try again.",
  expired: "The connection attempt expired. Please try again.",
  access_denied: "Access was not granted.",
  scope_missing: "Every requested permission is required. Please try again and tick every box.",
  no_refresh_token:
    "No refresh token was returned. Remove the app at myaccount.google.com/permissions (Google) or myapps.microsoft.com (Microsoft), then try again.",
  admin_consent_required:
    "Your organization requires an administrator to approve this app before mailboxes can connect.",
  provider_unavailable: "The provider is unavailable right now. Please try again in a few minutes.",
  exchange_failed: "The provider rejected the sign-in. Please try again.",
  server_error:
    "Something went wrong connecting the account. If you were reconnecting, it may have been deleted.",
};
const BLURB: Record<Provider, string> = {
  google: "Gmail or Google Workspace via OAuth",
  microsoft: "Outlook or Microsoft 365 via OAuth",
};
const DOC: Record<Provider, string> = {
  google: "docs/ops/GOOGLE_SETUP.md",
  microsoft: "docs/ops/MICROSOFT_SETUP.md",
};
const KEY = "oauth-session";
const PKEY = "oauth-provider"; // which provider a full-page flow was started for

type Poll = { status: "pending" | "success" | "error" | "expired"; errorCode?: string };

export function ConnectMenu({
  configured,
  reconnect,
  cards,
}: {
  configured: Record<Provider, boolean>;
  /** Reconnect this account (with its own provider) instead of connecting a new one. */
  reconnect?: { id: string; provider: Provider };
  /** The empty state's action cards instead of buttons (B5.3). */
  cards?: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Provider>(reconnect?.provider ?? "google");

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
      const p = sessionStorage.getItem(PKEY);
      if (p === "google" || p === "microsoft") setActive(p);
      sessionId.current = id;
      void poll(id, ++attempt.current);
    }
  }, [poll]);

  async function connect(provider: Provider) {
    setMsg("");
    setActive(provider);
    const mine = ++attempt.current;
    setBusy(true);
    const w = window.open("", "oauth", "popup,width=520,height=680"); // must open inside the click
    const res = await fetch(`/api/v1/oauth/${provider}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reconnect ? { reconnectAccountId: reconnect.id } : {}),
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
            ? `${NAME[provider]} is not configured on this server.`
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
      sessionStorage.setItem(PKEY, provider);
      sessionStorage.setItem(KEY, j.sessionId); // popup blocked: full-page redirect (the callback page sees this key), finished on return
      location.href = j.authUrl;
    }
  }

  const verb = reconnect ? "Reconnect" : "Connect";
  const providers = reconnect ? [reconnect.provider] : (["google", "microsoft"] as const);
  const label = (p: Provider) =>
    busy && active === p ? `Waiting for ${NAME[p]}...` : `${verb} ${NAME[p]}`;
  const why = (p: Provider) => `Not configured on this server (see ${DOC[p]})`;
  const cancelButton = busy && (
    <Button variant="outline" onClick={cancel}>
      Cancel
    </Button>
  );
  const alert = (
    <p role="alert" className="w-full text-[13px]/[18px] text-danger empty:hidden">
      {msg}
    </p>
  );
  if (cards)
    return (
      <>
        {providers.map((p) => (
          <ActionCard
            key={p}
            icon={Mail}
            title={label(p)}
            description={configured[p] ? BLURB[p] : why(p)}
            onClick={() => connect(p)}
            disabled={busy || !configured[p]}
          />
        ))}
        {cancelButton && <div>{cancelButton}</div>}
        {alert}
      </>
    );
  return (
    <>
      {providers.map((p) => (
        <Button
          key={p}
          variant="outline"
          onClick={() => connect(p)}
          disabled={busy || !configured[p]}
          title={configured[p] ? undefined : why(p)}
        >
          {label(p)}
        </Button>
      ))}
      {cancelButton}
      {alert}
    </>
  );
}

const ENV: Record<Provider, string> = {
  google: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
  microsoft: "MS_CLIENT_ID and MS_CLIENT_SECRET",
};

/** Says which providers this server cannot connect, and how to configure them (the buttons are disabled). */
export function NotConfigured({ providers }: { providers: Provider[] }) {
  if (providers.length === 0) return null;
  return (
    <Callout tone="neutral">
      {providers.map((p) => (
        <p key={p}>
          {NAME[p]} is not configured. Set {ENV[p]} (see {DOC[p]}).
        </p>
      ))}
    </Callout>
  );
}
