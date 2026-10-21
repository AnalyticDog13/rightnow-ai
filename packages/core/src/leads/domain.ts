const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  ...["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com"],
  ...["yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"],
  ...["gmx.com", "gmx.de", "web.de", "yandex.ru", "mail.ru", "zoho.com"],
]);

/** Email domain, or null for free-mail providers (a null domain never matches a company rule). */
export function companyDomainOf(email: string): string | null {
  const d = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return d && !FREE_MAIL_DOMAINS.has(d) ? d : null;
}
