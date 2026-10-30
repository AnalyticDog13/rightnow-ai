"use client";

import { FREE_MAIL_DOMAINS } from "@rightnow/core/domain";
import { useEffect, useRef, useState } from "react";
import { dialogClass } from "../../../components/overlay";
import { Button } from "../../../components/ui/button";
import { call, errorText } from "../accounts/api-client";

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
  const shared = FREE_MAIL_DOMAINS.has(domain.toLowerCase()); // a same-domain action on these would hit strangers
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

  const box = "flex min-h-11 items-start gap-2 text-sm md:min-h-0 [&>input]:mt-0.5";
  return (
    <dialog ref={ref} aria-labelledby="dl-title" onClose={onClose} className={dialogClass(480)}>
      <h2 id="dl-title" className="mb-4 text-lg/[26px] font-semibold break-all">
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
          <p role="alert" className="text-[13px]/[18px] text-danger">
            {err}
          </p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!del && !same && !block}
            onClick={() => void apply()}
          >
            Apply
          </Button>
        </div>
      </div>
    </dialog>
  );
}
