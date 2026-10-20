export const MS_SMTP_DISABLED_HINT =
  "Microsoft has SMTP AUTH disabled for this mailbox. Enable Authenticated SMTP for the mailbox or use Connect with Microsoft, remove the account, wait about an hour, then reconnect.";

/** Microsoft turns SMTP AUTH off per tenant or mailbox; its reply names 5.7.139 or SmtpClientAuthentication. */
export function msSmtpHint(host: string, response: string | undefined): string | null {
  const h = host.toLowerCase();
  const ms = h.endsWith("office365.com") || h.endsWith("outlook.com");
  return ms && /5\.7\.139|SmtpClientAuthentication/.test(response ?? "")
    ? MS_SMTP_DISABLED_HINT
    : null;
}

/** These providers save the sent copy themselves, so an APPEND would duplicate it. */
const SAVES_SENT = new Set(["smtp.gmail.com", "smtp.office365.com"]);
export const defaultAppendToSent = (smtpHost: string) => !SAVES_SENT.has(smtpHost.toLowerCase());
