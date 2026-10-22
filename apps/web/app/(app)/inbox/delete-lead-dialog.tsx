"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { call, errorText } from "../accounts/api-client";

// shortcut: a short local copy of the free-mail list (core's is not client-safe); a same-domain action on these would hit strangers
const FREE = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "live.com",
  "msn.com",
]);

/** PS-INBOX-15: delete the lead (which stops it in every campaign), optionally everyone at the same domain, optionally block future outreach. */
export function DeleteLeadDialog({
  lead,
  isAdmin,
  onClose,
  onDone,
}: {
  lead: { id: string; email: string };
  isAdmin: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const domain = lead.email.split("@")[1] ?? "";
  const shared = FREE.has(domain);
  const [del, setDel] = useState(true);
  const [same, setSame] = useState(false);
  const [block, setBlock] = useState(false);
  const [err, setErr] = useState("");

  async function apply() {
    setErr("");
    if (block) {
      const r = await call("/api/v1/blocklist", "POST", {
        values: shared ? [lead.email] : [lead.email, domain],
      });
      if (!r.ok) return setErr(errorText(r));
    }
    if (same) {
      const found = await call(
        `/api/v1/leads?q=${encodeURIComponent(`@${domain}`)}&take=200`,
        "GET",
      );
      const ids = ((found.json.leads as { id: string; email: string }[]) ?? [])
        .filter((l) => l.email.endsWith(`@${domain}`) && l.id !== lead.id)
        .map((l) => l.id);
      if (ids.length) {
        const r = await call("/api/v1/leads/bulk", "POST", { ids, action: "delete" });
        if (!r.ok) return setErr(errorText(r));
      }
    }
    if (del) {
      const r = await call(`/api/v1/leads/${lead.id}`, "DELETE");
      if (!r.ok) return setErr(errorText(r));
    }
    onDone("Done.");
  }

  const box = "flex items-start gap-2 text-sm";
  return (
    <dialog
      ref={ref}
      aria-labelledby="dl-title"
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/40"
    >
      <h2 id="dl-title" className="mb-3 text-lg font-semibold">
        Delete or block {lead.email}
      </h2>
      <div className="flex flex-col gap-3">
        <label className={box}>
          <input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} />
          Delete this lead and remove it from all campaigns
        </label>
        <label className={box}>
          <input
            type="checkbox"
            checked={same}
            disabled={shared || !isAdmin}
            onChange={(e) => setSame(e.target.checked)}
          />
          Also delete every lead at @{domain}
          {shared ? " (not offered for free-mail domains)" : !isAdmin ? " (admins only)" : ""}
        </label>
        <label className={box}>
          <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />
          Block future outreach to {shared ? "this address" : `this address and @${domain}`}
        </label>
        {err && (
          <p role="alert" className="text-sm text-red-600">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button disabled={!del && !same && !block} onClick={() => void apply()}>
            Apply
          </Button>
        </div>
      </div>
    </dialog>
  );
}
