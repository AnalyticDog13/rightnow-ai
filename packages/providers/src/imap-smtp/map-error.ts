import {
  AmbiguousSendError,
  AuthError,
  PermanentSendError,
  ProviderError,
  RateLimitedError,
  TransientBeforeSendError,
} from "../errors";

/** The fields nodemailer and imapflow put on their errors. Messages are never copied: they can hold server replies. */
type Raw = {
  code?: string;
  command?: string;
  responseCode?: number;
  response?: string;
  responseText?: string;
  responseStatus?: string;
  serverResponseCode?: string;
  authenticationFailed?: boolean;
  tlsFailed?: boolean;
  message?: string;
};
const raw = (e: unknown) => (e && typeof e === "object" ? (e as Raw) : {});

/** assertPublicHost refused the host (internal address in vps mode). Raised before any socket opens, so it is a retryable non-send error: a DNS rebind must not fail a message for good. */
export class HostNotAllowedError extends TransientBeforeSendError {
  constructor() {
    super("host resolves to a private address");
  }
}

const TLS_CERT =
  /certificate|self[- ]signed|altname|unable to verify|ERR_TLS|CERT_|wrong version number/i;

/** SMTP failure to the provider error contract. `dataStarted`: the message body was handed to the socket, so a lost reply is ambiguous. */
export function mapSmtpError(e: unknown, dataStarted: boolean): ProviderError {
  if (e instanceof ProviderError) return e;
  const r = raw(e);
  const rc = r.responseCode;
  if (r.code === "ETLS" || r.command === "STARTTLS")
    return new TransientBeforeSendError("tls_required");
  // Only a reply that says the credentials were refused is an auth failure (535; 534/530: mechanism or auth required).
  if ((r.code === "EAUTH" || rc === 535) && rc !== undefined && [530, 534, 535].includes(rc))
    return new AuthError("bad_credentials");
  if (rc && rc >= 400 && rc < 500) return new TransientBeforeSendError(`smtp ${rc}`);
  if (rc && rc >= 500) return new PermanentSendError(`smtp_${rc}`);
  if (dataStarted)
    return new AmbiguousSendError(`connection lost after data (${r.code ?? "error"})`);
  return new TransientBeforeSendError(tlsOrCode(r));
}

/** IMAP failure to the provider error contract (sync and lookups; nothing is sent over IMAP except the Sent copy). */
export function mapImapError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const r = raw(e);
  // imapflow sets authenticationFailed on ANY tagged NO/BAD to LOGIN, throttling and outages included.
  const text = `${r.responseText ?? ""} ${r.response ?? ""} ${r.message ?? ""}`;
  const code = (r.serverResponseCode ?? "").toUpperCase();
  if (/THROTTLED|^LIMIT/.test(code) || /too many|rate limit|throttl/i.test(text))
    return new RateLimitedError(60);
  if (
    /UNAVAILABLE|SERVERBUG|INUSE|TRYLATER/.test(code) ||
    /unavailable|try again|busy|temporar/i.test(text)
  )
    return new TransientBeforeSendError(code.toLowerCase() || "unavailable");
  if (r.authenticationFailed && !/^(E[A-Z]+|NoConnection)$/.test(r.code ?? ""))
    return new AuthError("bad_credentials");
  return new TransientBeforeSendError(tlsOrCode(r));
}

function tlsOrCode(r: Raw): string {
  if (r.tlsFailed || r.code === "ETLS" || r.command === "STARTTLS") return "tls_required";
  if (TLS_CERT.test(r.message ?? "") || TLS_CERT.test(r.code ?? "")) return "tls_certificate";
  return r.code ?? r.serverResponseCode ?? "connection";
}

/** What the user sees for a failed check: a stable code and an actionable sentence (never the server's words). */
export function diagnose(e: unknown): { code: string; message: string } {
  if (
    e instanceof AuthError ||
    mapSmtpError(e, false) instanceof AuthError ||
    mapImapError(e) instanceof AuthError
  )
    return {
      code: "bad_credentials",
      message: "The server rejected the username or password. Some providers need an app password.",
    };
  if (e instanceof HostNotAllowedError)
    return {
      code: "host_not_public",
      message: "This host resolves to a private address, which is not allowed here.",
    };
  const r = raw(e);
  const code = tlsOrCode(r);
  if (code === "tls_required")
    return {
      code,
      message:
        "The server does not offer an encrypted connection (STARTTLS or SSL/TLS). Logins are not sent without it.",
    };
  if (code === "tls_certificate")
    return {
      code,
      message: "The server's TLS certificate could not be verified for this host name.",
    };
  const net = r.code ?? "";
  if (net === "ECONNREFUSED")
    return { code: "connection_refused", message: "Connection refused. Check the host and port." };
  if (
    /ENOTFOUND|EAI_AGAIN|EDNS/.test(net) ||
    (e instanceof TransientBeforeSendError && /dns/.test(e.detail ?? ""))
  )
    return { code: "dns_failed", message: "The host name could not be resolved." };
  if (/TIMEDOUT|Timeout/i.test(net) || /timeout|timed out/i.test(r.message ?? ""))
    return { code: "timeout", message: "The server did not answer in time." };
  return { code: "connection_failed", message: "Could not complete the connection." };
}
