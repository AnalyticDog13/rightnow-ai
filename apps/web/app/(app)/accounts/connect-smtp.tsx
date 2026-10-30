"use client";

import { Server as ServerIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionCard } from "../../../components/empty-state";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select } from "../../../components/ui/select";
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
      <span role="alert" className="text-[13px]/[18px] text-danger">
        {errors[`${id}.${k}`]}
      </span>
    );
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
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
          <Select
            id={`${id}-security`}
            value={value.secure ? "tls" : "starttls"}
            onChange={(e) => set("secure", e.target.value === "tls")}
          >
            <option value="tls">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
          </Select>
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

/**
 * `reconnect` re-enters the credentials of an existing account (same id, email fixed) inline in the account drawer
 * (one dialog at a time); a new connection opens in a 640px dialog. `card` shows the trigger as an empty-state card.
 */
export function ConnectSmtp({
  reconnect,
  onDone,
  card,
}: {
  reconnect?: { id: string; email: string };
  onDone?: () => void;
  card?: boolean;
} = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!reconnect);
  const [email, setEmail] = useState(reconnect?.email ?? "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [imap, setImap] = useState(blank("993", true));
  const [smtp, setSmtp] = useState(blank("587", false));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [tested, setTested] = useState(false); // the current values passed Test connection
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !reconnect) dialog.current?.showModal();
  }, [open, reconnect]);

  // Any edit invalidates a passed test: Save only ever stores what was tested.
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setTested(false);
    };

  function build() {
    const e: Record<string, string> = {};
    if (reconnect) {
      /* the mailbox is fixed */
    } else if (!email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      e.email = "Enter a valid email address";
    if (!reconnect && !firstName.trim()) e.firstName = "First name is required";
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
    if (reconnect) return { imap: server(imap), smtp: server(smtp) };
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
      kind === "test"
        ? "/api/v1/accounts/test-connection"
        : reconnect
          ? `/api/v1/accounts/${reconnect.id}/credentials`
          : "/api/v1/accounts",
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
      onDone?.();
    } else {
      setTested(false);
      setMsg(
        MESSAGES[j.error ?? ""] ??
          (r.status === 422 ? "The connection checks failed." : "Could not save the account."),
      );
    }
  }

  const trigger = card ? (
    <ActionCard
      icon={ServerIcon}
      title="Connect with SMTP/IMAP"
      description="Any mailbox with IMAP and SMTP access"
      onClick={() => setOpen(true)}
    />
  ) : (
    <Button variant="outline" onClick={() => setOpen(true)}>
      Connect with SMTP/IMAP
    </Button>
  );
  const close = () => {
    setOpen(false);
    onDone?.();
  };
  const form = (
    <>
      <h2 className="text-lg/6.5 font-semibold">
        {reconnect ? "Update SMTP/IMAP credentials" : "Connect with SMTP/IMAP"}
      </h2>
      <div className={reconnect ? "hidden" : "grid gap-3 sm:grid-cols-3"}>
        <Field id="smtp-email" label="Email" error={errors.email}>
          <Input
            id="smtp-email"
            type="email"
            value={email}
            onChange={(e) => edit(setEmail)(e.target.value)}
          />
        </Field>
        <Field id="smtp-first" label="First name" error={errors.firstName}>
          <Input
            id="smtp-first"
            value={firstName}
            onChange={(e) => edit(setFirstName)(e.target.value)}
          />
        </Field>
        <Field id="smtp-last" label="Last name">
          <Input
            id="smtp-last"
            value={lastName}
            onChange={(e) => edit(setLastName)(e.target.value)}
          />
        </Field>
      </div>
      <Fields id="imap" title="IMAP" value={imap} onChange={edit(setImap)} errors={errors} />
      <Fields id="smtp" title="SMTP" value={smtp} onChange={edit(setSmtp)} errors={errors} />
      {checks && (
        <ul aria-label="Connection checks" className="flex flex-col gap-1 text-sm">
          {checks.map((c) => (
            <li key={c.name} className={c.ok ? "" : "text-danger"}>
              <strong>{CHECK_LABEL[c.name] ?? c.name}</strong>: {c.ok ? "passed" : "failed"}
              {!c.ok && c.message ? `. ${c.message}` : ""}
            </li>
          ))}
        </ul>
      )}
      <p role="alert" className="text-[13px]/[18px] text-danger empty:hidden">
        {msg}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => (reconnect ? close() : dialog.current?.close())}>
          Cancel
        </Button>
        {reconnect ? (
          // the server runs the checks and saves only if they pass
          <Button disabled={busy} onClick={() => run("save")}>
            {busy ? "Working..." : "Test and save"}
          </Button>
        ) : (
          <>
            <Button variant="outline" disabled={busy} onClick={() => run("test")}>
              {busy ? "Working..." : "Test connection"}
            </Button>
            <Button disabled={busy || !tested} onClick={() => run("save")}>
              Save
            </Button>
          </>
        )}
      </div>
    </>
  );
  if (reconnect)
    return open ? (
      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">{form}</div>
    ) : null;
  return (
    <>
      {trigger}
      {open && (
        <dialog
          ref={dialog}
          aria-label="Connect with SMTP/IMAP"
          onClose={close}
          className="m-auto w-[min(640px,calc(100vw-32px))] max-w-none overflow-y-auto rounded-xl bg-surface p-6 text-fg shadow-e3 open:animate-pop max-md:mb-0 max-md:max-h-[90dvh] max-md:w-screen max-md:rounded-b-none md:max-h-[calc(100dvh-64px)]"
        >
          <div className="flex flex-col gap-4">{form}</div>
        </dialog>
      )}
    </>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <span role="alert" className="text-[13px]/[18px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
