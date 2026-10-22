"use client";

import type { DomainReport } from "@rightnow/core";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call, errorText } from "./api-client";

const STATUS = { pass: "OK", warn: "Warning", fail: "Failed", unknown: "Unknown" } as const;

/** PS-WARM-14 / PS-WARM-19: each DNS check with its reason and fix, a fresh re-check and custom DKIM selectors. */
export function DomainSection({ email, canEdit }: { email: string; canEdit: boolean }) {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  const [report, setReport] = useState<DomainReport | null>(null);
  const [selectors, setSelectors] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void call("/api/v1/domains", "GET").then((r) => {
      const row = (
        r.json.domains as
          { domain: string; report: DomainReport; selectors: string[] }[] | undefined
      )?.find((d) => d.domain === domain);
      if (row) {
        setReport(row.report);
        setSelectors(row.selectors.join(", "));
      }
    });
  }, [domain]);

  async function run(method: string, url: string, body: unknown, busy: string) {
    setMsg(busy);
    const r = await call(url, method, body);
    if (!r.ok) return setMsg(errorText(r));
    setReport(r.json.report as DomainReport);
    setMsg("Checked.");
  }
  const url = `/api/v1/domains/${encodeURIComponent(domain)}`;
  const rows: [
    string,
    (
      | DomainReport["spf"]
      | DomainReport["dkim"]
      | DomainReport["dmarc"]
      | DomainReport["mx"]
      | DomainReport["dnsbl"]
      | DomainReport["ptr"]
    ),
  ][] = report
    ? [
        ["SPF", report.spf],
        ["DKIM", report.dkim],
        ["DMARC", report.dmarc],
        ["MX", report.mx],
        ["Blocklists", report.dnsbl],
        ["Reverse DNS (submission host)", report.ptr],
      ]
    : [];

  return (
    <section
      aria-label="Domain"
      className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm"
    >
      <h3 className="font-medium">Domain: {domain}</h3>
      {report?.managed && <p>Managed by the mailbox provider; no DNS setup needed.</p>}
      {!report && (
        <p>Not checked yet. Checks also run when you launch a campaign and once a day.</p>
      )}
      {report && !report.managed && (
        <>
          <ul className="flex flex-col gap-1">
            {rows.map(([name, c]) =>
              c ? (
                <li key={name}>
                  <strong>{name}:</strong> {STATUS[c.status]}. {c.reason}
                  {c.status !== "pass" && c.fix ? (
                    <span className="block text-muted-foreground">Fix: {c.fix}</span>
                  ) : null}
                </li>
              ) : null,
            )}
          </ul>
          <p className="text-muted-foreground">
            Last checked {new Date(report.checkedAt).toLocaleString()}
          </p>
        </>
      )}
      {canEdit && !report?.managed && (
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => run("POST", `${url}/check`, {}, "Checking...")}>
            Re-check
          </Button>
          <Label htmlFor="dkim-selectors">Custom DKIM selectors (comma separated)</Label>
          <div className="flex gap-2">
            <Input
              id="dkim-selectors"
              value={selectors}
              onChange={(e) => setSelectors(e.target.value)}
            />
            <Button
              variant="outline"
              onClick={() =>
                run(
                  "PATCH",
                  url,
                  {
                    selectors: selectors
                      .split(",")
                      .map((s) => s.trim().toLowerCase())
                      .filter(Boolean),
                  },
                  "Saving...",
                )
              }
            >
              Apply selectors
            </Button>
          </div>
        </div>
      )}
      <p aria-live="polite">{msg}</p>
    </section>
  );
}
