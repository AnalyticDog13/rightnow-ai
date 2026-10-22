"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { call, errorText } from "../../accounts/api-client";

type Test = { id: string; accountId: string; subject: string; createdAt: string };
type Report = {
  id: string;
  seeds: { accountId: string; email: string; esp: string; folder: string }[];
  dnsbl: { reason: string; listed: { zone: string }[] } | null;
  spamAssassin: string;
};
type Account = { id: string; email: string };
const sel = "h-10 rounded-md border border-border bg-card px-3 text-sm";
const FOLDER: Record<string, string> = {
  INBOX: "Inbox",
  SPAM: "Spam",
  OTHER: "Other folder",
  MISSING: "Not found",
  PENDING: "Waiting for the result",
};
const ERRORS: Record<string, string> = {
  no_seeds:
    "No seed mailboxes: mark at least one other connected account as an inbox placement seed.",
  account_unavailable:
    "This account cannot send right now (paused, disconnected or its provider is not live-verified).",
  provider_cap: "Today's quota for this account has no room for a placement test.",
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

  const loadTests = useCallback(async () => {
    const r = await call("/api/v1/placement-tests", "GET");
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
  }, [shown]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setMsg("Sending...");
    const r = await call("/api/v1/placement-tests", "POST", { accountId, subject, body });
    if (!r.ok) return setMsg(ERRORS[errorText(r)] ?? errorText(r));
    setMsg("Sent. Results appear in about 10 minutes.");
    setShown(r.json.id as string);
    await loadTests();
  }

  const email = (id: string) => accounts.find((a) => a.id === id)?.email ?? id;
  const dnsbl = report?.dnsbl
    ? `${report.dnsbl.reason}${report.dnsbl.listed.length ? ` (${report.dnsbl.listed.map((l) => l.zone).join(", ")})` : ""}`
    : "not checked yet";
  return (
    <div className="flex flex-col gap-6">
      {isAdmin && (
        <Card>
          <form onSubmit={start} className="flex max-w-xl flex-col gap-3">
            <Label htmlFor="pl-account">Account to test</Label>
            <select
              id="pl-account"
              className={sel}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
            <Label htmlFor="pl-subject">Test subject</Label>
            <Input
              id="pl-subject"
              value={subject}
              maxLength={500}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
            <Label htmlFor="pl-body">Test message</Label>
            <textarea
              id="pl-body"
              className="min-h-24 rounded-md border border-border bg-card p-3 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!accountId}>
                Start placement test
              </Button>
              <span role="status" className="text-sm text-muted-foreground">
                {msg}
              </span>
            </div>
          </form>
        </Card>
      )}
      {tests.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="pl-past">Past tests</Label>
          <select
            id="pl-past"
            className={sel}
            value={shown}
            onChange={(e) => setShown(e.target.value)}
          >
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {new Date(t.createdAt).toLocaleString()} - {email(t.accountId)} - {t.subject}
              </option>
            ))}
          </select>
        </div>
      )}
      {report && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left font-medium">Where the test message landed</caption>
            <thead>
              <tr>
                <th className="py-1 pr-4">Seed mailbox</th>
                <th className="py-1 pr-4">Provider</th>
                <th className="py-1">Folder</th>
              </tr>
            </thead>
            <tbody>
              {report.seeds.map((s) => (
                <tr key={s.accountId}>
                  <td className="py-1 pr-4">{s.email}</td>
                  <td className="py-1 pr-4">{s.esp}</td>
                  <td className="py-1">{FOLDER[s.folder] ?? s.folder}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm">Blocklists: {dnsbl}</p>
          <p className="text-sm text-muted-foreground">SpamAssassin: {report.spamAssassin}</p>
        </Card>
      )}
    </div>
  );
}
