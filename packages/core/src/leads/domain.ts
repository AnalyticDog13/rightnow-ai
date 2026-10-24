/** Client-safe (`@rightnow/core/domain`): no imports, so the inbox dialog uses this list too. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  ...["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com"],
  ...["yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"],
  ...["gmx.com", "gmx.de", "web.de", "yandex.ru", "mail.ru", "zoho.com"],
]);

/** Lower-cased part after the last "@" (the whole string when there is none). */
export const domainOf = (email: string): string =>
  email.slice(email.lastIndexOf("@") + 1).toLowerCase();

/** Email domain, or null for free-mail providers (a null domain never matches a company rule). */
export function companyDomainOf(email: string): string | null {
  const d = domainOf(email);
  return d && !FREE_MAIL_DOMAINS.has(d) ? d : null;
}
