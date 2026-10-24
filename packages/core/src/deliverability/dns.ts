import { createPublicKey } from "node:crypto";
import { Resolver } from "node:dns/promises";
import type { AccountProvider, Prisma, PrismaClient } from "@rightnow/db/client";
import { mapLimit } from "@rightnow/providers";
import { AccountError } from "../accounts/service";
import { decryptCredentials } from "../accounts/credentials";
import { audit } from "../audit";
import type { DnsFinding, LaunchDeps } from "../campaigns/launch";
import type { Clock } from "../clock";
import { FREE_MAIL_DOMAINS } from "../leads/domain";
import { domainOf } from "../leads/domain";

type Db = PrismaClient;

/** The four lookups the checks need; tests inject a fake, production uses Node's resolver (D35). */
export type DnsResolver = {
  resolveTxt(n: string): Promise<string[][]>;
  resolveMx(n: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(n: string): Promise<string[]>;
  reverse(ip: string): Promise<string[]>;
};
const node = new Resolver({ timeout: 5000, tries: 2 });
export const systemResolver: DnsResolver = {
  resolveTxt: (n) => node.resolveTxt(n),
  resolveMx: (n) => node.resolveMx(n),
  resolve4: (n) => node.resolve4(n),
  reverse: (ip) => node.reverse(ip),
};

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";
export type Check = { status: CheckStatus; reason: string; fix?: string };
export type DomainReport = {
  domain: string;
  checkedAt: string;
  managed: boolean;
  spf: Check & { record: string | null; lookups: number };
  dkim: Check & { selectors: { selector: string; bits: number | null }[] };
  dmarc: Check & { policy: "none" | "quarantine" | "reject" | null };
  mx: Check & { hosts: string[] };
  dnsbl: Check & { listed: { zone: string; target: string }[] };
  ptr: (Check & { host: string | null }) | null;
};

const UNREACHABLE = "Could not check (DNS unreachable)";
const UNREACHABLE_FIX = "Check the network and the domain's name servers, then re-check.";
const ok = (reason: string): Check => ({ status: "pass", reason });
const warn = (reason: string, fix: string): Check => ({ status: "warn", reason, fix });
const fail = (reason: string, fix: string): Check => ({ status: "fail", reason, fix });
const unknown = (): Check => ({ status: "unknown", reason: UNREACHABLE, fix: UNREACHABLE_FIX });

// A lookup is a value, null (NXDOMAIN or no data) or ERR (anything else, including a resolver that throws).
const ERR = Symbol("dns-error");
type Look<T> = T | null | typeof ERR;
async function look<T>(f: () => Promise<T>): Promise<Look<T>> {
  try {
    return await f();
  } catch (e) {
    return ["ENOTFOUND", "ENODATA"].includes((e as { code?: string }).code ?? "") ? null : ERR;
  }
}
const txt = (r: DnsResolver, n: string) =>
  look(async () => (await r.resolveTxt(n)).map((c) => c.join("")));

const SPF_RE = /^v=spf1(\s|$)/i;
const GOOGLE_INCLUDE = "_spf.google.com";
const OUTLOOK_INCLUDE = "spf.protection.outlook.com";
const NEEDED: Partial<Record<AccountProvider, [string, string]>> = {
  GMAIL: [GOOGLE_INCLUDE, "Google"],
  MICROSOFT: [OUTLOOK_INCLUDE, "Microsoft"],
};
const FLATTEN =
  "If you flatten SPF, keep the provider's include (include:_spf.google.com / include:spf.protection.outlook.com).";
const SPF_FIX = `Publish exactly one TXT record on the domain that starts with v=spf1, e.g. "v=spf1 include:_spf.google.com ~all" (Google) or "v=spf1 include:spf.protection.outlook.com ~all" (Microsoft 365).`;
const TERM = /^[+\-~?]?(include|a|mx|ptr|exists|redirect)(?=$|[:=/])(?:[:=]([^/\s]+))?/i;

async function checkSpf(r: DnsResolver, domain: string, providers: AccountProvider[]) {
  type Spf = DomainReport["spf"];
  const done = (c: Check, record: string | null, lookups: number): Spf => ({
    ...c,
    record,
    lookups,
  });
  const root = await txt(r, domain);
  if (root === ERR) return done(unknown(), null, 0);
  const recs = (root ?? []).filter((t) => SPF_RE.test(t));
  if (!recs.length) return done(fail("No SPF record", SPF_FIX), null, 0);
  if (recs.length > 1)
    return done(
      fail("More than one SPF record", "Merge the v=spf1 TXT records into a single record."),
      null,
      0,
    );

  let lookups = 0;
  const included = new Set<string>();
  // Walks include/redirect recursively; each DNS-querying mechanism counts (RFC 7208 §4.6.4). Returns the first problem.
  const walk = async (rec: string, path: Set<string>): Promise<Check | null> => {
    for (const term of rec.split(/\s+/).slice(1)) {
      const m = TERM.exec(term);
      if (!m) continue;
      if (++lookups > 10)
        return fail(
          "SPF needs more than 10 DNS lookups",
          `Remove includes or replace them with ip4:/ip6: ranges. ${FLATTEN}`,
        );
      const kind = m[1]!.toLowerCase();
      const target = m[2]?.toLowerCase();
      if ((kind !== "include" && kind !== "redirect") || !target) continue;
      included.add(target);
      if (path.has(target))
        return fail(
          "SPF includes form a loop",
          `Remove the include of ${target} that points back.`,
        );
      const t = await txt(r, target);
      if (t === ERR) return unknown();
      const found = (t ?? []).filter((x) => SPF_RE.test(x));
      if (found.length !== 1)
        return fail(
          `SPF include ${target} has no single SPF record`,
          `Fix or remove include:${target}.`,
        );
      const bad = await walk(found[0]!, new Set(path).add(target));
      if (bad) return bad;
    }
    return null;
  };
  const rec = recs[0]!;
  const bad = await walk(rec, new Set([domain]));
  if (bad) return done(bad, rec, lookups);
  for (const p of new Set(providers)) {
    const need = NEEDED[p];
    if (need && !included.has(need[0]))
      return done(
        fail(
          `SPF does not authorize ${need[1]}`,
          `Add include:${need[0]} to the SPF record. ${FLATTEN}`,
        ),
        rec,
        lookups,
      );
  }
  if (rec.split(/\s+/).some((t) => /^[+?]?all$/i.test(t)))
    return done(
      warn("SPF allows any sender (+all or ?all)", "End the record with ~all or -all."),
      rec,
      lookups,
    );
  return done(ok("SPF record found"), rec, lookups);
}

const PROVIDER_SELECTORS = ["google", "selector1", "selector2"];
const COMMON_SELECTORS = ["default", "dkim", "mail", "k1", "s1", "s2", "smtp"];

/** RSA modulus length of a DKIM `p=` value, null when it is not a parseable RSA key. */
function keyBits(p: string): number | null {
  try {
    const k = createPublicKey({ key: Buffer.from(p, "base64"), format: "der", type: "spki" });
    return k.asymmetricKeyDetails?.modulusLength ?? null;
  } catch {
    return null;
  }
}

async function checkDkim(r: DnsResolver, domain: string, custom: string[]) {
  const tried = [...new Set([...PROVIDER_SELECTORS, ...COMMON_SELECTORS, ...custom])];
  const res = await Promise.all(tried.map((s) => txt(r, `${s}._domainkey.${domain}`)));
  let onlyEd = true;
  const selectors = tried.flatMap((selector, i) => {
    const recs = Array.isArray(res[i]) ? (res[i] as string[]) : [];
    const rec = recs.find((t) => /(?:^|;)\s*p=[A-Za-z0-9+/=]/.test(t));
    const p = rec && /(?:^|;)\s*p=([A-Za-z0-9+/=\s]+)/.exec(rec)?.[1]?.replace(/\s/g, "");
    if (!p) return [];
    if (!/(?:^|;)\s*k=ed25519/i.test(rec)) onlyEd = false;
    return [{ selector, bits: keyBits(p) }];
  });
  const strong = selectors.find((s) => (s.bits ?? 0) >= 1024);
  const c: Check = strong
    ? ok(`DKIM key found (selector ${strong.selector}, ${strong.bits} bits)`)
    : selectors.length
      ? warn(
          onlyEd
            ? "Only an ed25519 key found; Gmail and Microsoft verify RSA keys"
            : "DKIM key shorter than 1024 bits",
          "Generate a 2048-bit DKIM key in your mail provider and publish it.",
        )
      : res.includes(ERR)
        ? unknown()
        : warn(
            `No DKIM key found at selectors: ${tried.join(", ")}`,
            "Publish your provider's DKIM key, or add your own selector in the Domain section.",
          );
  return { ...c, selectors };
}

async function checkDmarc(r: DnsResolver, domain: string) {
  const labels = domain.split(".");
  const names = [
    `_dmarc.${domain}`,
    ...(labels.length > 2 ? [`_dmarc.${labels.slice(-2).join(".")}`] : []),
  ];
  let errored = false;
  for (const n of names) {
    const t = await txt(r, n);
    if (t === ERR) {
      errored = true;
      continue;
    }
    const rec = (t ?? []).find((x) => /^v=DMARC1\b/i.test(x));
    if (rec) {
      const p = /(?:^|;)\s*p=(none|quarantine|reject)/i.exec(rec)?.[1]?.toLowerCase();
      return p
        ? { ...ok(`DMARC record found (p=${p})`), policy: p as DomainReport["dmarc"]["policy"] }
        : {
            ...warn(
              "DMARC record has no policy",
              `Add p=none (or quarantine/reject) to the record at _dmarc.${domain}.`,
            ),
            policy: null,
          };
    }
  }
  return {
    ...(errored
      ? unknown()
      : warn(
          "No DMARC record",
          `Publish a TXT record at _dmarc.${domain}, e.g. "v=DMARC1; p=none; rua=mailto:you@${domain}".`,
        )),
    policy: null,
  };
}

async function checkMx(r: DnsResolver, domain: string) {
  const m = await look(() => r.resolveMx(domain));
  if (m === ERR) return { ...unknown(), hosts: [] as string[] };
  const all = (m ?? []).sort((a, b) => a.priority - b.priority).map((x) => x.exchange);
  const hosts = all.filter((h) => h !== "." && h !== "");
  if (all.length && !hosts.length)
    return {
      ...fail("Domain accepts no mail (null MX)", "Replace the null MX with real mail servers."),
      hosts,
    };
  return {
    ...(hosts.length
      ? ok("MX records found")
      : warn("No MX record", "Add MX records so replies and bounces can reach the domain.")),
    hosts,
  };
}

const ipNum = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
// 127.0.0.2-127.0.1.254 is a listing; 127.0.1.255 (DBL "IP queries prohibited"), 127.255.255.* (refused public resolver) and 127.0.0.1 are not.
const [LISTED_MIN, LISTED_MAX] = [ipNum("127.0.0.2"), ipNum("127.0.1.254")];
const DOMAIN_ZONES = ["dbl.spamhaus.org", "multi.surbl.org"];
const IP_ZONES = ["zen.spamhaus.org", "bl.spamcop.net", "b.barracudacentral.org"];

async function listing(r: DnsResolver, name: string): Promise<"listed" | "clean" | "unknown"> {
  const a = await look(() => r.resolve4(name));
  if (a === ERR) return "unknown";
  if (a === null) return "clean";
  return a.some((x) => ipNum(x) >= LISTED_MIN && ipNum(x) <= LISTED_MAX) ? "listed" : "unknown";
}
const hostIps = async (r: DnsResolver, host: string): Promise<Look<string[]>> =>
  /^\d+\.\d+\.\d+\.\d+$/.test(host) ? [host] : look(() => r.resolve4(host));

async function checkDnsbl(r: DnsResolver, domain: string, smtpHosts: string[]) {
  const queries: { zone: string; name: string; target: string; host: boolean }[] = DOMAIN_ZONES.map(
    (zone) => ({ zone, name: `${domain}.${zone}`, target: domain, host: false }),
  );
  const unchecked: string[] = [];
  for (const host of smtpHosts) {
    const ips = await hostIps(r, host);
    if (ips === ERR) unchecked.push(`submission host ${host}`);
    for (const ip of Array.isArray(ips) ? ips : [])
      for (const zone of IP_ZONES)
        queries.push({
          zone,
          name: `${ip.split(".").reverse().join(".")}.${zone}`,
          target: host,
          host: true,
        });
  }
  const res = await Promise.all(queries.map((q) => listing(r, q.name)));
  const hits = queries.filter((_, i) => res[i] === "listed");
  const listed = hits.map((q) => ({ zone: q.zone, target: q.target }));
  unchecked.push(...queries.filter((_, i) => res[i] === "unknown").map((q) => q.zone));
  const c: Check = hits.length
    ? warn(
        `Listed on ${hits.map((q) => `${q.zone} (${q.host ? `submission host ${q.target}` : q.target})`).join("; ")}`,
        "Request delisting from the blocklist operator and fix the cause before sending.",
      )
    : unchecked.length
      ? { ...unknown(), reason: `${UNREACHABLE}: ${[...new Set(unchecked)].join(", ")}` }
      : ok("Not listed on the DNS blocklists checked");
  return { ...c, listed };
}

async function checkPtr(r: DnsResolver, host: string) {
  const ips = await hostIps(r, host);
  if (ips === ERR) return { ...unknown(), host: null };
  const names = ips?.[0] ? await look(() => r.reverse(ips[0]!)) : null;
  if (names === ERR) return { ...unknown(), host: null };
  return names?.[0]
    ? { ...ok(`Submission host ${host} has reverse DNS ${names[0]}`), host: names[0] }
    : {
        ...warn(
          `No reverse DNS (PTR) for submission host ${host}`,
          "Ask the SMTP provider to set reverse DNS for the sending IP.",
        ),
        host: null,
      };
}

const MANAGED: Check = ok("Managed by the mailbox provider");
const managedReport = (domain: string): DomainReport => ({
  domain,
  checkedAt: new Date().toISOString(),
  managed: true,
  spf: { ...MANAGED, record: null, lookups: 0 },
  dkim: { ...MANAGED, selectors: [] },
  dmarc: { ...MANAGED, policy: null },
  mx: { ...MANAGED, hosts: [] },
  dnsbl: { ...MANAGED, listed: [] },
  ptr: null,
});

/** Runs every check for one domain; lookup failures become `unknown`, nothing here throws. */
export async function checkDomain(
  r: DnsResolver,
  domain: string,
  o: {
    providers: AccountProvider[];
    smtpHosts: string[];
    selectors: string[];
    /** Total time for all checks; whatever is still running becomes `unknown` (default 20 s). */
    deadlineMs?: number;
  },
): Promise<DomainReport> {
  domain = domain.toLowerCase();
  if (FREE_MAIL_DOMAINS.has(domain)) return managedReport(domain);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">(
    (res) => (timer = setTimeout(() => res("late"), o.deadlineMs ?? 20_000)),
  );
  const within = <T>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([p, late]).then((v) => (v === "late" ? fallback : v));
  const [spf, dkim, dmarc, mx, dnsbl, ptr] = await Promise.all([
    within(checkSpf(r, domain, o.providers), { ...unknown(), record: null, lookups: 0 }),
    within(checkDkim(r, domain, o.selectors), { ...unknown(), selectors: [] }),
    within(checkDmarc(r, domain), { ...unknown(), policy: null }),
    within(checkMx(r, domain), { ...unknown(), hosts: [] }),
    within(checkDnsbl(r, domain, o.smtpHosts), { ...unknown(), listed: [] }),
    o.smtpHosts[0] ? within(checkPtr(r, o.smtpHosts[0]), { ...unknown(), host: null }) : null,
  ]).finally(() => clearTimeout(timer));
  return {
    domain,
    checkedAt: new Date().toISOString(),
    managed: false,
    spf,
    dkim,
    dmarc,
    mx,
    dnsbl,
    ptr,
  };
}

/** Block only for a failed SPF; every other non-pass check is one warn. */
export function findings(rep: DomainReport): DnsFinding[] {
  const checks: [string, Check | null][] = [
    ["spf", rep.spf],
    ["dkim", rep.dkim],
    ["dmarc", rep.dmarc],
    ["mx", rep.mx],
    ["dnsbl", rep.dnsbl],
    ["ptr", rep.ptr],
  ];
  return checks.flatMap(([name, c]) =>
    c && c.status !== "pass"
      ? [
          {
            domain: rep.domain,
            level: name === "spf" && c.status === "fail" ? ("block" as const) : ("warn" as const),
            reason: c.reason,
            fix: c.fix,
          },
        ]
      : [],
  );
}
const levelOf = (f: DnsFinding[]) =>
  f.some((x) => x.level === "block") ? "block" : f.length ? "warn" : "ok";

/** Host name of an SMTP account's submission server (the only credential detail ever stored in a report). */
function smtpHost(enc: string | null): string[] {
  try {
    const c = enc ? decryptCredentials(enc) : null;
    return c?.kind === "smtp" ? [c.smtp.host.toLowerCase()] : [];
  } catch {
    return [];
  }
}

async function checkOne(
  prisma: Db,
  r: DnsResolver,
  clock: Clock,
  ws: string,
  domain: string,
  selectors?: string[],
) {
  const where = { workspaceId_domain: { workspaceId: ws, domain } };
  const [accounts, prev] = await Promise.all([
    prisma.emailAccount.findMany({
      where: { workspaceId: ws, deletedAt: null, email: { endsWith: `@${domain}` } },
      select: { provider: true, credentialsEnc: true },
    }),
    prisma.domainCheck.findUnique({ where }),
  ]);
  // Network first, no transaction open.
  const report = {
    ...(await checkDomain(r, domain, {
      providers: [...new Set(accounts.map((a) => a.provider))],
      smtpHosts: [...new Set(accounts.flatMap((a) => smtpHost(a.credentialsEnc)))],
      selectors: selectors ?? prev?.selectors ?? [],
    })),
    checkedAt: clock.now().toISOString(),
  };
  const data = {
    level: levelOf(findings(report)),
    report: report as unknown as Prisma.InputJsonObject,
    checkedAt: clock.now(),
  };
  await prisma.domainCheck.upsert({
    where,
    create: { workspaceId: ws, domain, ...data, selectors: selectors ?? [] },
    update: { ...data, ...(selectors && { selectors }) },
  });
  return { level: data.level, report };
}

/** Fresh checks (outside any tx), then one upsert per domain. */
export async function checkWorkspaceDomains(
  prisma: Db,
  r: DnsResolver,
  clock: Clock,
  ws: string,
  domains: string[],
): Promise<DomainReport[]> {
  const uniq = [...new Set(domains.map((d) => d.toLowerCase()))];
  // about 25 lookups per domain: 5 domains at a time, so public blocklists do not refuse a burst (A-4)
  return (await mapLimit(uniq, 5, (d) => checkOne(prisma, r, clock, ws, d))).map((x) => x.report);
}

/** The launch/resume DNS gate: always a fresh check (D35). */
export const dnsGate =
  (prisma: Db, r: DnsResolver, clock: Clock, ws: string): NonNullable<LaunchDeps["dnsGate"]> =>
  async (domains) =>
    (await checkWorkspaceDomains(prisma, r, clock, ws, domains)).flatMap(findings);

/** Daily job: every distinct domain of every live account, once. Returns how many domains were checked. */
export async function recheckDomains(prisma: Db, clock: Clock, r: DnsResolver): Promise<number> {
  const rows = await prisma.emailAccount.findMany({
    where: { deletedAt: null },
    select: { workspaceId: true, email: true },
  });
  const by = new Map<string, Set<string>>();
  for (const a of rows) {
    const set = by.get(a.workspaceId) ?? new Set<string>();
    set.add(domainOf(a.email));
    by.set(a.workspaceId, set);
  }
  let n = 0;
  for (const [ws, domains] of by)
    try {
      n += (await checkWorkspaceDomains(prisma, r, clock, ws, [...domains])).length;
    } catch (e) {
      console.error(`recheckDomains: workspace ${ws} skipped this run`, e); // the others still run (G-M7)
    }
  return n;
}

export const listDomainChecks = (prisma: Db, ws: string) =>
  prisma.domainCheck.findMany({ where: { workspaceId: ws }, orderBy: { domain: "asc" } });

/** 404 unless the domain belongs to a live account of the workspace (M8). */
async function owned(prisma: Db, ws: string, domain: string) {
  const n = await prisma.emailAccount.count({
    where: { workspaceId: ws, deletedAt: null, email: { endsWith: `@${domain}` } },
  });
  if (!n) throw new AccountError(404, "Not found");
}

export async function recheckDomain(
  prisma: Db,
  r: DnsResolver,
  clock: Clock,
  ws: string,
  actorId: string | null | undefined,
  domain: string,
) {
  domain = domain.toLowerCase();
  await owned(prisma, ws, domain);
  const out = await checkOne(prisma, r, clock, ws, domain);
  await audit(prisma, { workspaceId: ws, actorId, at: clock.now() }, "domain.check", domain, {
    level: out.level,
  });
  return out;
}

/** Saves the user's extra DKIM selectors and re-checks with them. */
export async function setDomainSelectors(
  prisma: Db,
  r: DnsResolver,
  clock: Clock,
  ws: string,
  actorId: string | null | undefined,
  domain: string,
  selectors: string[],
) {
  domain = domain.toLowerCase();
  await owned(prisma, ws, domain);
  const out = await checkOne(prisma, r, clock, ws, domain, [...new Set(selectors)]);
  await audit(prisma, { workspaceId: ws, actorId, at: clock.now() }, "domain.selectors", domain, {
    selectors: [...new Set(selectors)],
  });
  return out;
}

/** DNS section of the diagnostics response; null for managed domains. Never changes account status. */
export async function accountDns(
  prisma: Db,
  r: DnsResolver,
  ws: string,
  a: { email: string; provider: AccountProvider; credentialsEnc: string | null },
): Promise<DomainReport | null> {
  const domain = domainOf(a.email);
  const prev = await prisma.domainCheck.findUnique({
    where: { workspaceId_domain: { workspaceId: ws, domain } },
  });
  const rep = await checkDomain(r, domain, {
    providers: [a.provider],
    smtpHosts: smtpHost(a.credentialsEnc),
    selectors: prev?.selectors ?? [],
  });
  return rep.managed ? null : rep;
}
