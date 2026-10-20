import type { EmailAccount } from "@rightnow/db/client";

const HIDDEN = [
  "credentialsEnc",
  "syncCursor",
  "refreshLeaseId",
  "refreshLeaseUntil",
  "credentialGen",
] as const;
export type ApiAccount = Omit<EmailAccount, (typeof HIDDEN)[number]>;

/** PS-ACC-07: the only shape of an account any API returns; credentials, cursor and lease never leave the server. */
export function toApiAccount(a: EmailAccount): ApiAccount {
  const out: Record<string, unknown> = { ...a };
  for (const k of HIDDEN) delete out[k];
  return out as ApiAccount;
}
