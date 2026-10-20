"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { call } from "./api-client";

type Server = { host: string; port: string; secure: boolean; username: string; password: string };
type Check = { name: string; ok: boolean; message?: string; code?: string };
const CHECK_LABEL: Record<string, string> = {
  imap_login: "IMAP login",
  smtp_auth: "SMTP login",
  sent_folder: "Sent folder",
  api: "Connection",
};
const blank = (port: string, secure: boolean): Server => ({
  host: "",
  port,
  secure,
  username: "",
  password: "",
});
const MESSAGES: Record<string, string> = {
  account_exists: "That mailbox is already connected.",
};

function Fields({
  id,
  title,
  value,
  onChange,
  errors,
}: {
  id: string;
  title: string;
  value: Server;
  onChange: (s: Server) => void;
  errors: Record<string, string>;
}) {
  const set = (k: keyof Server, v: string | boolean) => onChange({ ...value, [k]: v });
  const err = (k: string) =>
    errors[`${id}.${k}`] && (
      <span role="alert" className="text-xs text-destructive">
        {errors[`${id}.${k}`]}
      </span>
    );
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-host`}>{title} host</Label>
        <Input
          id={`${id}-host`}
          value={value.host}
          onChange={(e) => set("host", e.target.value)}
          placeholder={id === "imap" ? "imap.example.com" : "smtp.example.com"}
        />
        {err("host")}
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`${id}-port`}>{title} port</Label>
          <Input
            id={`${id}-port`}
            inputMode="numeric"
            value={value.port}
            onChange={(e) => set("port", e.target.value)}
          />
          {err("port")}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`${id}-security`}>{title} security</Label>
          <select
            id={`${id}-security`}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm"
            value={value.secure ? "tls" : "starttls"}
            onChange={(e) => set("secure", e.target.value === "tls")}
          >
            <option value="tls">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-user`}>{title} username</Label>
        <Input
          id={`${id}-user`}
          autoComplete="off"
          value={value.username}
          onChange={(e) => set("username", e.target.value)}
          placeholder="defaults to the email address"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-pass`}>{title} password</Label>
        <Input
          id={`${id}-pass`}
          type="password"
          autoComplete="new-password"
          value={value.password}
          onChange={(e) => set("password", e.target.value)}
        />
        {err("password")}
      </div>
    </fieldset>
  );
}

export function ConnectSmtp() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [imap, setImap] = useState(blank("993", true));
  const [smtp, setSmtp] = useState(blank("587", false));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [tested, setTested] = useState(false); // the current values passed Test connection
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Any edit invalidates a passed test: Save only ever stores what was tested.
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setTested(false);
    };

  function build() {
    const e: Record<string, string> = {};
    if (!email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      e.email = "Enter a valid email address";
    if (!firstName.trim()) e.firstName = "First name is required";
    const side = (id: "imap" | "smtp", s: Server) => {
      if (!s.host.trim()) e[`${id}.host`] = "Host is required";
      else if (!/^[A-Za-z0-9.:[\]-]+$/.test(s.host.trim()))
        e[`${id}.host`] = "Enter a host name, not a URL";
      const port = Number(s.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        e[`${id}.port`] = "Port must be 1 to 65535";
      if (!s.password) e[`${id}.password`] = "Password is required";
    };
    side("imap", imap);
    side("smtp", smtp);
    setErrors(e);
    if (Object.keys(e).length) return null;
    const server = (s: Server) => ({
      host: s.host.trim(),
      port: Number(s.port),
      secure: s.secure,
      username: s.username.trim() || email.trim(),
      password: s.password,
    });
    return {
      email: email.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      imap: server(imap),
      smtp: server(smtp),
    };
  }

  async function run(kind: "test" | "save") {
    setMsg("");
    const body = build();
    if (!body) return;
    setBusy(true);
    const r = await call(
      kind === "test" ? "/api/v1/accounts/test-connection" : "/api/v1/accounts",
      "POST",
      body,
    );
    setBusy(false);
    const j = r.json as { ok?: boolean; checks?: Check[]; error?: string };
    if (j.checks) setChecks(j.checks);
    if (kind === "test") {
      if (!r.ok) setMsg("Could not run the checks.");
      setTested(r.ok && !!j.ok);
      return;
    }
    if (r.ok) {
      setOpen(false);
      setChecks(null);
      setTested(false);
      setImap(blank("993", true)); // drop the passwords from memory
      setSmtp(blank("587", false));
      setEmail("");
      router.refresh();
    } else {
      setTested(false);
      setMsg(
        MESSAGES[j.error ?? ""] ??
          (r.status === 422 ? "The connection checks failed." : "Could not save the account."),
      );
    }
  }

  if (!open)
    return (
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Connect with SMTP/IMAP
        </Button>
      </div>
    );
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Connect with SMTP/IMAP</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="smtp-email">Email</Label>
          <Input
            id="smtp-email"
            type="email"
            value={email}
            onChange={(e) => edit(setEmail)(e.target.value)}
          />
          {errors.email && (
            <span role="alert" className="text-xs text-destructive">
              {errors.email}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="smtp-first">First name</Label>
          <Input
            id="smtp-first"
            value={firstName}
            onChange={(e) => edit(setFirstName)(e.target.value)}
          />
          {errors.firstName && (
            <span role="alert" className="text-xs text-destructive">
              {errors.firstName}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="smtp-last">Last name</Label>
          <Input
            id="smtp-last"
            value={lastName}
            onChange={(e) => edit(setLastName)(e.target.value)}
          />
        </div>
      </div>
      <Fields id="imap" title="IMAP" value={imap} onChange={edit(setImap)} errors={errors} />
      <Fields id="smtp" title="SMTP" value={smtp} onChange={edit(setSmtp)} errors={errors} />
      {checks && (
        <ul aria-label="Connection checks" className="flex flex-col gap-1 text-sm">
          {checks.map((c) => (
            <li key={c.name} className={c.ok ? "" : "text-destructive"}>
              <strong>{CHECK_LABEL[c.name] ?? c.name}</strong>: {c.ok ? "passed" : "failed"}
              {!c.ok && c.message ? `. ${c.message}` : ""}
            </li>
          ))}
        </ul>
      )}
      <p role="alert" className="min-h-5 text-sm text-destructive">
        {msg}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => run("test")}>
          {busy ? "Working..." : "Test connection"}
        </Button>
        <Button disabled={busy || !tested} onClick={() => run("save")}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
