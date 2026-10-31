"use client";

import type { DomainReport } from "@rightnow/core";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { DNS, DNS_TONE, pillFor, StatusPill } from "../../../components/status-pill";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call, errorText } from "./api-client";

const STATUS = { pass: "OK", warn: "Warning", fail: "Failed", unknown: "Unknown" } as const;

/** The domain verdict, as in core `findings()`: only a failed SPF blocks; any other non-pass check warns. */
const verdict = (r: DomainReport | null) => {
  if (!r) return "DNS not checked";
  if (r.managed) return "DNS OK"; // a managed report's checks may be empty; its pill is not shown anyway
  if (r.spf.status === "fail") return "DNS blocks sending";
  const checks = [r.spf, r.dkim, r.dmarc, r.mx, r.dnsbl, r.ptr];
  return checks.some((c) => c && c.status !== "pass") ? "DNS warning" : "DNS OK";
};

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
  const level = verdict(report);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-sm font-semibold">Domain: {domain}</h3>
        {!report?.managed && <StatusPill {...pillFor(DNS, level)}>{level}</StatusPill>}
        {report &&
          !report.managed &&
          rows.slice(0, 4).map(([name, c]) =>
            c ? (
              <StatusPill key={name} tone={DNS_TONE[c.status]} size="sm" title={c.reason}>
                <span className="micro">{name}</span>
              </StatusPill>
            ) : null,
          )}
      </div>
      {report?.managed && <p>Managed by the mailbox provider; no DNS setup needed.</p>}
      {!report && (
        <p className="text-fg-muted">
          Not checked yet. Checks also run when you launch a campaign and once a day.
        </p>
      )}
      {report && !report.managed && (
        <>
          <ul className="flex flex-col gap-3">
            {rows.map(([name, c]) =>
              c ? (
                <li key={name} className="flex flex-col gap-1.5">
                  <span>
                    <strong className="font-medium">{name}:</strong> {STATUS[c.status]}. {c.reason}
                  </span>
                  {c.status !== "pass" && c.fix ? (
                    <span className="flex items-start gap-2 rounded-sm bg-sunken py-1.5 pr-1.5 pl-3">
                      <code className="min-w-0 flex-1 font-mono text-[13px]/5 break-words">
                        Fix: {c.fix}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Copy the ${name} fix`}
                        onClick={() => void navigator.clipboard?.writeText(c.fix ?? "")}
                      >
                        <Copy aria-hidden />
                      </Button>
                    </span>
                  ) : null}
                </li>
              ) : null,
            )}
          </ul>
          <p className="text-fg-subtle">
            Last checked {new Date(report.checkedAt).toLocaleString()}
          </p>
        </>
      )}
      {canEdit && !report?.managed && (
        <div className="flex flex-col gap-3">
          <div>
            <Button
              variant="outline"
              onClick={() => run("POST", `${url}/check`, {}, "Checking...")}
            >
              Re-check
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
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
        </div>
      )}
      <p aria-live="polite" className="text-[13px]/[18px]">
        {msg}
      </p>
    </div>
  );
}
