"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "../../../../components/empty-state";
import { pillFor, StatusPill, type PillSpec } from "../../../../components/status-pill";
import { TableFrame } from "../../../../components/table-kit";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input, Textarea } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Select } from "../../../../components/ui/select";
import { call, errorText } from "../../accounts/api-client";

type Test = { id: string; accountId: string; subject: string; createdAt: string };
type Report = {
  id: string;
  seeds: { accountId: string; email: string; esp: string; folder: string }[];
  dnsbl: { reason: string; listed: { zone: string }[] } | null;
  spamAssassin: string;
};
type Account = { id: string; email: string };
const FOLDER: Record<string, string> = {
  INBOX: "Inbox",
  SPAM: "Spam",
  OTHER: "Other folder",
  MISSING: "Not found",
  PENDING: "Waiting for the result",
};
const FOLDER_PILL: Record<string, PillSpec> = {
  Inbox: { tone: "success" },
  Spam: { tone: "danger" },
  "Other folder": { tone: "warning" },
  "Not found": { tone: "warning" },
  "Waiting for the result": { tone: "info" },
};
const ERRORS: Record<string, string> = {
  no_seeds:
    "No seed mailboxes: mark at least one other connected account as an inbox placement seed.",
  account_unavailable:
    "This account cannot send right now (paused, disconnected or its provider is not live-verified).",
  provider_cap:
    "Today's quota for this account has no room for a placement test (ramp, health throttle or re-warm may be limiting it).",
  rate_limited: "At most 3 placement tests per account per hour. Try again later.",
};

export function PlacementManager({ isAdmin }: { isAdmin: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [accountId, setAccountId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [shown, setShown] = useState("");
  const [msg, setMsg] = useState("");
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const loadTests = useCallback(async () => {
    const r = await call("/api/v1/placement-tests", "GET");
    setLoaded(true);
    if (!r.ok) return;
    const t = r.json.tests as Test[];
    setTests(t);
    setShown((cur) => cur || t[0]?.id || "");
  }, []);
  useEffect(() => {
    void loadTests();
    void call("/api/v1/accounts", "GET").then((r) => {
      if (!r.ok) return;
      const a = r.json.accounts as Account[];
      setAccounts(a);
      setAccountId((cur) => cur || a[0]?.id || "");
    });
  }, [loadTests]);
  useEffect(() => {
    if (!shown) return;
    let live = true;
    const load = async () => {
      const r = await call(`/api/v1/placement-tests/${shown}`, "GET");
      if (live && r.ok) setReport(r.json as unknown as Report);
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [shown, reload]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setMsg("Sending...");
    const r = await call("/api/v1/placement-tests", "POST", { accountId, subject, body });
    if (!r.ok) return setMsg(ERRORS[errorText(r)] ?? errorText(r));
    setMsg("Queued. Sending the test messages...");
    setShown(r.json.id as string);
    await loadTests();
    // poll the placement_run job with a growing delay, for about 5 minutes
    for (
      let wait = 2000, left = 300_000;
      left > 0;
      left -= wait, wait = Math.min(wait * 1.5, 15_000)
    ) {
      await new Promise((res) => setTimeout(res, wait));
      const j = await call(`/api/v1/jobs/${r.json.jobId as string}`, "GET");
      if (!j.ok) continue;
      if (j.json.status === "FAILED")
        return setMsg(
          `Sending failed: ${ERRORS[String(j.json.error)] ?? String(j.json.error ?? "unknown error")}`,
        );
      if (j.json.status === "DONE") {
        setMsg("Sent. Results appear in about 10 minutes.");
        return setReload((n) => n + 1);
      }
    }
    setMsg("Still sending. The report below updates when the messages are out.");
  }

  const email = (id: string) => accounts.find((a) => a.id === id)?.email ?? id;
  const dnsbl = report?.dnsbl
    ? `${report.dnsbl.reason}${report.dnsbl.listed.length ? ` (${report.dnsbl.listed.map((l) => l.zone).join(", ")})` : ""}`
    : "not checked yet";
  return (
    <div className="flex flex-col gap-6">
      {isAdmin && (
        <Card className="max-w-3xl">
          <form onSubmit={start} className="flex flex-col gap-4">
            <h2 className="text-base font-semibold">Run a placement test</h2>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-account">Account to test</Label>
              <Select
                id="pl-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-subject">Test subject</Label>
              <Input
                id="pl-subject"
                value={subject}
                maxLength={500}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-body">Test message</Label>
              <Textarea
                id="pl-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!accountId} className="max-md:w-full">
                Start placement test
              </Button>
              <span role="status" className="text-[13px]/[18px] text-fg-muted">
                {msg}
              </span>
            </div>
          </form>
        </Card>
      )}
      {loaded && tests.length === 0 && (
        <Card className="max-w-3xl p-0 md:p-0">
          <EmptyState
            icon={FlaskConical}
            title="No placement tests yet."
            body="Mark one of your own mailboxes as a placement seed in its account settings, then run a test."
            actions={
              <Button asChild variant="link">
                <Link href="/accounts">Open Email Accounts</Link>
              </Button>
            }
          />
        </Card>
      )}
      {tests.length > 0 && (
        <div className="flex max-w-3xl flex-col gap-1.5">
          <Label htmlFor="pl-past">Past tests</Label>
          <Select id="pl-past" value={shown} onChange={(e) => setShown(e.target.value)}>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {new Date(t.createdAt).toLocaleString()} - {email(t.accountId)} - {t.subject}
              </option>
            ))}
          </Select>
        </div>
      )}
      {report && (
        <div className="flex max-w-3xl flex-col gap-3">
          <TableFrame>
            <table>
              <caption className="border-b border-border px-4 py-3 text-left text-base font-semibold">
                Where the test message landed
              </caption>
              <thead>
                <tr>
                  <th scope="col" data-pin="id" className="max-md:left-0">
                    Seed mailbox
                  </th>
                  <th scope="col" className="hidden md:table-cell">
                    Provider
                  </th>
                  <th scope="col">Folder</th>
                </tr>
              </thead>
              <tbody>
                {report.seeds.map((s) => {
                  const folder = FOLDER[s.folder] ?? s.folder;
                  return (
                    <tr key={s.accountId}>
                      <td
                        data-pin="id"
                        className="max-w-56 truncate font-medium max-md:left-0"
                        title={s.email}
                      >
                        {s.email}
                      </td>
                      <td className="hidden md:table-cell">{s.esp}</td>
                      <td>
                        <StatusPill {...pillFor(FOLDER_PILL, folder)}>{folder}</StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
          <p className="text-sm">Blocklists: {dnsbl}</p>
          <p className="text-[13px]/[18px] text-fg-muted">SpamAssassin: {report.spamAssassin}</p>
        </div>
      )}
    </div>
  );
}
