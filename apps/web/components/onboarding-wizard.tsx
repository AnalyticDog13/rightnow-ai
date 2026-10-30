"use client";

import { Check, Copy, Eye, EyeOff, Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { authClient } from "../lib/auth-client";
import { cn } from "../lib/utils";
import { Callout } from "./callout";
import { Button } from "./ui/button";
import { Helper, Input } from "./ui/input";
import { Label } from "./ui/label";

/** B5.18 first-run wizard. Values live only in React state: never in the URL or browser storage. */

type Values = {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
  token: string;
};
type Errors = Partial<Record<keyof Values, string>>;

const STEPS = ["Verify server", "Your login", "Workspace"];
const TITLES = ["Verify this is your server", "Create your owner login", "Name your workspace"];
const TOKEN_WRONG =
  "That doesn't match SETUP_TOKEN in your .env file. Check for extra spaces or quotes.";
const RATE_LIMITED = "Too many attempts. Wait 15 minutes and try again.";
const CLOSED = "Sign-up is closed. This workspace already has an owner; sign in instead.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as {
    error?: string;
    issues?: { message: string }[];
  };
  return { status: res.status, message: j.issues?.[0]?.message ?? j.error ?? "Sign-up failed" };
}

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [v, setV] = useState<Values>({
    name: "",
    email: "",
    password: "",
    workspaceName: "",
    token: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // Disabled until hydrated so a native GET submit can never put the password in the URL.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step]);

  const set = (k: keyof Values) => (e: { target: { value: string } }) => {
    setV((o) => ({ ...o, [k]: e.target.value }));
    if (errors[k]) setErrors((o) => ({ ...o, [k]: undefined }));
  };
  const go = (n: number) => {
    setErrors({});
    setFormError("");
    setStep(n);
  };
  /** Shows the errors and focuses the first invalid field; true when the step is valid. */
  const valid = (e: Errors) => {
    setErrors(e);
    const first = Object.keys(e).find((k) => e[k as keyof Values]);
    if (first) document.getElementById(first)?.focus();
    return !first;
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (step === 0) return go(1);
    if (step === 1) {
      if (!valid({ token: v.token ? undefined : "Paste the setup token." })) return;
      setBusy(true);
      const r = await post("/api/setup/verify-token", { token: v.token });
      setBusy(false);
      if (r.status === 200) return go(2);
      return valid({
        token:
          r.status === 403
            ? TOKEN_WRONG
            : r.status === 429
              ? RATE_LIMITED
              : r.status === 409
                ? CLOSED
                : r.message,
      });
    }
    if (step === 2) {
      if (
        !valid({
          name: v.name.trim() ? undefined : "Enter your name.",
          email: EMAIL.test(v.email.trim()) ? undefined : "Enter a valid email address.",
          password:
            v.password.length < 12
              ? "Use at least 12 characters."
              : v.password.length > 128
                ? "Use at most 128 characters."
                : undefined,
        })
      )
        return;
      return go(3);
    }
    if (!valid({ workspaceName: v.workspaceName.trim() ? undefined : "Enter a workspace name." }))
      return;
    setFormError("");
    setBusy(true);
    try {
      const r = await post("/api/setup", { ...v, email: v.email.trim() });
      if (r.status === 403) {
        go(1);
        setErrors({ token: TOKEN_WRONG });
        return setBusy(false);
      }
      if (r.status !== 200) throw new Error(r.status === 429 ? RATE_LIMITED : r.message);
      const { data, error: err } = await authClient.signIn.email({
        email: v.email.trim(),
        password: v.password,
      });
      if (err) throw new Error(err.message ?? "Sign-in failed");
      router.push(
        data && "twoFactorRedirect" in data && data.twoFactorRedirect
          ? "/sign-in/2fa"
          : "/dashboard",
      );
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div
      data-wide
      className="grid overflow-hidden rounded-xl border border-border bg-surface lg:grid-cols-[480px_1fr]"
    >
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-6 p-6 md:p-8 lg:p-10">
        <p aria-live="polite" className="sr-only">
          {step > 0 && `Step ${step} of 3: ${TITLES[step - 1]}`}
        </p>
        {step > 0 && <Progress step={step} />}

        {step === 0 && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-[32px]/[40px] font-semibold tracking-[-0.015em] max-md:text-2xl/8">
                Welcome to rightnow
              </p>
              <h1 ref={heading} tabIndex={-1} className="text-xl/7 font-semibold outline-none">
                Set up the owner account
              </h1>
            </div>
            <p className="text-fg-muted">
              rightnow is your self-hosted cold-email workspace. Connect your own mailboxes, warm
              them up, send multi-step campaigns that stop when someone replies, and handle replies
              in one inbox and pipeline.
            </p>
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Setup takes about two minutes</h2>
              <ol className="flex flex-col">
                {[
                  "Verify this is your server: paste the setup token from your .env file",
                  "Create your owner login: you will be the workspace admin",
                  "Name your workspace: usually your company name",
                ].map((t, i) => (
                  <li key={t} className="flex min-h-12 items-center gap-3 py-1.5">
                    <Num>{i + 1}</Num>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-col gap-3">
              <Button type="submit" size="lg" className="w-full" disabled={!ready}>
                Get started
              </Button>
              <p className="text-center text-[13px]/[18px] text-fg-muted">
                Already set up?{" "}
                <Link className="text-signal underline" href="/sign-in">
                  Sign in
                </Link>
              </p>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <StepHead heading={heading} title={TITLES[0]!}>
              Anyone who can open this page could claim the workspace, so the first account needs
              the secret you set when installing rightnow. It is the SETUP_TOKEN value in the .env
              file on your server.
            </StepHead>
            <Callout tone="neutral" title="Where to find it">
              <div className="mt-1.5 flex flex-col gap-2">
                <div className="flex flex-col gap-1 rounded-sm bg-sunken p-1">
                  <CopyLine command="grep SETUP_TOKEN .env" label="Copy command" />
                  <CopyLine command="Select-String SETUP_TOKEN .env" label="Copy Windows command" />
                </div>
                <p>
                  Run it in the folder where you installed rightnow. Copy the part after the = sign,
                  without quotes.
                </p>
              </div>
            </Callout>
            <Field id="token" label="Setup token" error={errors.token} errorRole="alert">
              <Secret
                id="token"
                value={v.token}
                onChange={set("token")}
                autoComplete="off"
                show="Show token"
                hide="Hide token"
                invalid={!!errors.token}
                mono
              />
            </Field>
            <Footer back={() => go(0)} busy={busy} ready={ready} />
          </>
        )}

        {step === 2 && (
          <>
            <StepHead heading={heading} title={TITLES[1]!}>
              You will be the owner: the only admin until you invite teammates from Settings.
            </StepHead>
            <div className="flex flex-col gap-4">
              <Field id="name" label="Your name" error={errors.name}>
                <TextInput
                  id="name"
                  value={v.name}
                  onChange={set("name")}
                  autoComplete="name"
                  error={errors.name}
                />
              </Field>
              <Field id="email" label="Email" error={errors.email}>
                <TextInput
                  id="email"
                  type="email"
                  value={v.email}
                  onChange={set("email")}
                  autoComplete="email"
                  error={errors.email}
                />
              </Field>
              <Field id="password" label="Password (12+ characters)" error={errors.password}>
                <Secret
                  id="password"
                  value={v.password}
                  onChange={set("password")}
                  autoComplete="new-password"
                  show="Show password"
                  hide="Hide password"
                  invalid={!!errors.password}
                  describedBy="password-hint"
                />
                <p
                  id="password-hint"
                  className={cn(
                    "num flex items-center gap-1 text-[13px]/[18px]",
                    v.password.length >= 12 ? "text-success" : "text-fg-muted",
                  )}
                >
                  {v.password.length >= 12 && <Check className="size-3.5" aria-hidden />}
                  {v.password.length} / 12 characters
                </p>
              </Field>
            </div>
            <Footer back={() => go(1)} busy={busy} ready={ready} />
          </>
        )}

        {step === 3 && (
          <>
            <StepHead heading={heading} title={TITLES[2]!} />
            <Field id="workspaceName" label="Workspace name" error={errors.workspaceName}>
              <TextInput
                id="workspaceName"
                value={v.workspaceName}
                onChange={set("workspaceName")}
                error={errors.workspaceName}
                describedBy="workspace-help"
              />
              <Helper id="workspace-help">
                Shown in the sidebar and to teammates. You can change it later in Settings.
              </Helper>
            </Field>
            <dl className="flex flex-col gap-3 rounded-lg bg-sunken p-4">
              <Review label="Owner" edit="Edit owner" onEdit={() => go(2)}>
                {v.name.trim()} · {v.email.trim()}
              </Review>
              <Review
                label="Workspace"
                edit="Edit workspace"
                onEdit={() => document.getElementById("workspaceName")?.focus()}
              >
                {v.workspaceName.trim() || <span className="text-fg-subtle">Not set yet</span>}
              </Review>
            </dl>
            <div className="flex flex-col gap-2">
              <p role="alert" className="min-h-5 text-sm text-danger">
                {formError}
              </p>
              <div className="flex flex-col gap-3 md:flex-row-reverse md:justify-between">
                <Button
                  type="submit"
                  size="lg"
                  className="max-md:w-full"
                  loading={busy}
                  disabled={!ready}
                >
                  {busy ? "Creating account..." : "Create owner account"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="max-md:w-full"
                  onClick={() => go(2)}
                >
                  Back
                </Button>
              </div>
            </div>
          </>
        )}
      </form>
      <NextSteps />
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="num font-mono text-[13px]/[20px] text-fg-muted">Step {step} of 3</p>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={step}
        aria-valuetext={`Step ${step} of 3`}
        className="h-1 overflow-hidden rounded-xs bg-sunken"
      >
        <div className="h-full bg-fg" style={{ width: `${(step / 3) * 100}%` }} />
      </div>
      <ol className="hidden gap-4 text-[13px]/[18px] md:flex">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i + 1 === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-1",
              i + 1 === step
                ? "font-semibold text-fg"
                : i + 1 < step
                  ? "text-fg-muted"
                  : "text-fg-subtle",
            )}
          >
            {i + 1 < step && (
              <>
                <Check className="size-3.5" aria-hidden />
                <span className="sr-only">Done: </span>
              </>
            )}
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepHead({
  heading,
  title,
  children,
}: {
  heading: RefObject<HTMLHeadingElement | null>;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h1 ref={heading} tabIndex={-1} className="text-xl/7 font-semibold outline-none">
        {title}
      </h1>
      {children && <p className="text-fg-muted">{children}</p>}
    </div>
  );
}

function Num({ children }: { children: ReactNode }) {
  return (
    <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-xs font-medium text-fg-subtle">
      {children}
    </span>
  );
}

function Field({
  id,
  label,
  error,
  errorRole,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  errorRole?: "alert";
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {errorRole ? (
        <p id={`${id}-error`} role="alert" className="min-h-5 text-[13px]/[18px] text-danger">
          {error}
        </p>
      ) : (
        error && (
          <p id={`${id}-error`} className="text-[13px]/[18px] text-danger">
            {error}
          </p>
        )
      )}
    </div>
  );
}

const describe = (id: string, error?: unknown, extra?: string) =>
  [error ? `${id}-error` : "", extra ?? ""].filter(Boolean).join(" ") || undefined;

function TextInput({
  id,
  error,
  describedBy,
  ...props
}: {
  id: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  type?: string;
  autoComplete?: string;
  error?: string;
  describedBy?: string;
}) {
  return (
    <Input
      id={id}
      name={id}
      className="md:h-11"
      aria-invalid={!!error || undefined}
      aria-describedby={describe(id, error, describedBy)}
      {...props}
    />
  );
}

function Secret({
  id,
  show,
  hide,
  invalid,
  mono,
  describedBy,
  ...props
}: {
  id: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  autoComplete: string;
  show: string;
  hide: string;
  invalid: boolean;
  mono?: boolean;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={id}
        type={visible ? "text" : "password"}
        spellCheck={false}
        className={cn("pr-12 md:h-11", mono && "font-mono")}
        aria-invalid={invalid || undefined}
        aria-describedby={describe(id, invalid, describedBy)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1/2 right-1 -translate-y-1/2"
        aria-label={visible ? hide : show}
        aria-pressed={visible}
        onClick={() => setVisible((x) => !x)}
      >
        {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </Button>
    </div>
  );
}

function CopyLine({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2 pl-2">
      <code className="min-w-0 flex-1 font-mono text-[13px]/[20px] break-words">{command}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // clipboard blocked (insecure origin or permissions): the command stays selectable
          }
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  );
}

function Review({
  label,
  edit,
  onEdit,
  children,
}: {
  label: string;
  edit: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <dt className="text-[13px]/[18px] text-fg-muted">{label}</dt>
        <dd className="truncate font-medium">{children}</dd>
      </div>
      <Button type="button" variant="ghost" size="sm" aria-label={edit} onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}

function Footer({ back, busy, ready }: { back: () => void; busy: boolean; ready: boolean }) {
  // Continue comes first in the DOM (it is the stacked-first button on mobile); desktop shows it on the right.
  return (
    <div className="flex flex-col gap-3 md:flex-row-reverse md:justify-between">
      <Button
        type="submit"
        size="lg"
        className="max-md:w-full md:min-w-32"
        loading={busy}
        disabled={!ready}
      >
        Continue
      </Button>
      <Button type="button" variant="outline" size="lg" className="max-md:w-full" onClick={back}>
        Back
      </Button>
    </div>
  );
}

const NEXT = [
  ["Connect an email account", "Gmail, Microsoft 365 or any IMAP/SMTP mailbox you own."],
  ["Add your physical address", "Required in the footer of every email you send."],
  ["Import leads", "Upload a CSV of the people you want to reach."],
  ["Launch your first campaign", "Write a sequence; it stops for each lead who replies."],
];

function NextSteps() {
  return (
    <aside aria-label="What happens next" className="hidden flex-col gap-4 bg-sunken p-10 lg:flex">
      <div className="flex flex-col gap-1">
        <p className="micro text-fg-muted">After setup</p>
        <h3 className="text-sm font-semibold">Your first campaign in four steps</h3>
      </div>
      <ol className="flex flex-col gap-3">
        {NEXT.map(([t, d], i) => (
          <li key={t} className="flex gap-3 rounded-lg border border-border bg-surface p-4">
            <Num>{i + 1}</Num>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{t}</span>
              <span className="text-[13px]/[18px] text-fg-muted">{d}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-auto flex items-start gap-2 text-[13px]/[18px] text-fg-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Warm new accounts for at least two weeks before full volume.
      </p>
    </aside>
  );
}
