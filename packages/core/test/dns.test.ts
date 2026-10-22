import { generateKeyPairSync } from "node:crypto";
import { createTestDb } from "@rightnow/db/test-db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { encryptCredentials } from "../src/accounts/credentials";
import { launchCampaign, type LaunchDeps } from "../src/campaigns/launch";
import { PRESETS } from "../src/campaigns/schema";
import {
  createCampaign,
  setCampaignAccounts,
  setSchedules,
  type CampaignError,
} from "../src/campaigns/service";
import { fixedClock } from "../src/clock";
import { checkDomain, dnsGate, findings, recheckDomains } from "../src/deliverability/dns";
import { testEnv } from "./accounts-fixture";
import { dnsError, fakeResolver, type FakeRecord } from "./dns-fixture";

const D = "ex.test";
const GOOGLE = "v=spf1 include:_spf.google.com ~all";
const spki = (bits: number) =>
  generateKeyPairSync("rsa", { modulusLength: bits })
    .publicKey.export({ type: "spki", format: "der" })
    .toString("base64");
const dkim = (bits: number): FakeRecord => [[`v=DKIM1; k=rsa; p=${spki(bits)}`]];
type Rec = Record<string, FakeRecord | undefined>;
/** A domain that passes every check; an `undefined` override removes the record. */
const good = (over: Rec = {}) =>
  Object.fromEntries(
    Object.entries({
      [`${D}/TXT`]: [[GOOGLE]],
      [`${D}/MX`]: { mx: [{ exchange: "mx.ex.test", priority: 10 }] },
      [`_dmarc.${D}`]: [["v=DMARC1; p=reject"]],
      [`google._domainkey.${D}`]: dkim(2048),
      "_spf.google.com": [["v=spf1 include:_netblocks.google.com ~all"]],
      "_netblocks.google.com": [["v=spf1 ip4:35.190.247.0/24 ~all"]],
      ...over,
    }).filter(([, v]) => v !== undefined),
  ) as Record<string, FakeRecord>;
type Opts = Parameters<typeof checkDomain>[2];
const gm: Opts = { providers: ["GMAIL"], smtpHosts: [], selectors: [] };
const smtp: Opts = { ...gm, providers: ["SMTP"] };
const check = (rec: Rec, o = gm, d = D) => checkDomain(fakeResolver(good(rec)), d, o);

describe("spf", () => {
  test("pass with google include; nested lookups counted; no block finding", async () => {
    const rep = await check({});
    expect(rep.spf).toMatchObject({ status: "pass", record: GOOGLE, lookups: 2 });
    expect(findings(rep).filter((f) => f.level === "block")).toEqual([]);
  });

  test.each([
    ["missing", { [`${D}/TXT`]: undefined }, "No SPF record"],
    ["two records", { [`${D}/TXT`]: [[GOOGLE], ["v=spf1 -all"]] }, "More than one SPF record"],
    [
      "11 lookups",
      {
        [`${D}/TXT`]: [
          [`v=spf1 ${Array.from({ length: 11 }, (_, i) => `a:h${i}.test`).join(" ")} ~all`],
        ],
      },
      "SPF needs more than 10 DNS lookups",
    ],
    [
      "include loop",
      {
        [`${D}/TXT`]: [["v=spf1 include:loop.test ~all"]],
        "loop.test": [[`v=spf1 include:${D} ~all`]],
      },
      "SPF includes form a loop",
    ],
  ] as [string, Rec, string][])(
    "%s -> fail, one block finding with a fix",
    async (_n, over, reason) => {
      const rep = await check(over, smtp);
      expect(rep.spf).toMatchObject({ status: "fail", reason });
      expect(rep.spf.lookups).toBeLessThanOrEqual(11);
      const blocks = findings(rep).filter((f) => f.level === "block");
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ domain: D, reason });
      expect(blocks[0]!.fix).toBeTruthy();
    },
  );

  test("a gmail account not authorized fails; the same record passes for SMTP and Microsoft", async () => {
    const rec = {
      [`${D}/TXT`]: [["v=spf1 include:spf.protection.outlook.com ~all"]],
      "spf.protection.outlook.com": [["v=spf1 ip4:40.92.0.0/15 -all"]],
    };
    expect((await check(rec)).spf.status).toBe("fail");
    expect((await check(rec, smtp)).spf.status).toBe("pass");
    expect((await check(rec, { ...gm, providers: ["MICROSOFT"] })).spf.status).toBe("pass");
  });

  test("+all, ?all and a bare all warn", async () => {
    for (const all of ["+all", "?all", "all"]) {
      const rep = await check({ [`${D}/TXT`]: [[`v=spf1 ip4:1.2.3.4 ${all}`]] }, smtp);
      expect(rep.spf.status).toBe("warn");
    }
  });
});

describe("dkim", () => {
  test("a 2048-bit key at a provider selector passes", async () => {
    expect((await check({})).dkim).toMatchObject({
      status: "pass",
      selectors: [{ selector: "google", bits: 2048 }],
    });
  });
  test("only a 512-bit key warns; none warns naming the selectors tried", async () => {
    const short = await check({ [`google._domainkey.${D}`]: dkim(512) });
    expect(short.dkim).toMatchObject({ status: "warn", reason: "DKIM key shorter than 1024 bits" });
    const none = await check({ [`google._domainkey.${D}`]: undefined });
    expect(none.dkim.status).toBe("warn");
    expect(none.dkim.reason).toContain("google");
    expect(none.dkim.reason).toContain("selector1");
  });
  test("a user selector is probed", async () => {
    const rep = await check(
      { [`google._domainkey.${D}`]: undefined, [`mykey._domainkey.${D}`]: dkim(2048) },
      { ...gm, selectors: ["mykey"] },
    );
    expect(rep.dkim).toMatchObject({
      status: "pass",
      selectors: [{ selector: "mykey", bits: 2048 }],
    });
  });
});

describe("dmarc, mx, managed", () => {
  test("p=reject passes; the parent domain is used for a subdomain; missing warns", async () => {
    expect((await check({})).dmarc).toMatchObject({ status: "pass", policy: "reject" });
    const sub = await check(
      {
        [`mail.${D}/TXT`]: [[GOOGLE]],
        [`mail.${D}/MX`]: { mx: [{ exchange: "m", priority: 1 }] },
        [`google._domainkey.mail.${D}`]: dkim(2048),
        [`_dmarc.${D}`]: [["v=DMARC1; p=quarantine"]],
      },
      gm,
      `mail.${D}`,
    );
    expect(sub.dmarc).toMatchObject({ status: "pass", policy: "quarantine" });
    const none = await check({ [`_dmarc.${D}`]: undefined });
    expect(none.dmarc).toMatchObject({ status: "warn", policy: null });
    expect(none.dmarc.fix).toBeTruthy();
  });
  test("missing MX warns", async () => {
    const rep = await check({ [`${D}/MX`]: undefined });
    expect(rep.mx).toMatchObject({ status: "warn", hosts: [] });
  });
  test("a managed free-mail domain is ok with zero lookups", async () => {
    const r = fakeResolver({});
    const rep = await checkDomain(r, "gmail.com", gm);
    expect(rep.managed).toBe(true);
    expect(r.calls).toEqual([]);
    expect(findings(rep)).toEqual([]);
  });
});

describe("dnsbl and ptr", () => {
  test("127.0.1.2 is listed", async () => {
    const rep = await check({ [`${D}.dbl.spamhaus.org`]: ["127.0.1.2"] });
    expect(rep.dnsbl.status).toBe("warn");
    expect(rep.dnsbl.listed).toEqual([{ zone: "dbl.spamhaus.org", target: D }]);
  });
  test.each(["127.255.255.254", "127.0.1.255", "127.0.0.1"])(
    "%s is unknown, never listed",
    async (ans) => {
      const rep = await check({
        [`${D}.dbl.spamhaus.org`]: [ans],
        [`${D}.multi.surbl.org`]: [ans],
      });
      expect(rep.dnsbl.listed).toEqual([]);
      expect(rep.dnsbl.status).toBe("unknown");
    },
  );
  test("the submission host's IPs are queried reversed; no PTR warns", async () => {
    const r = fakeResolver(
      good({ "smtp.x.test": ["1.2.3.4"], "4.3.2.1.zen.spamhaus.org": ["127.0.0.2"] }),
    );
    const rep = await checkDomain(r, D, { ...smtp, smtpHosts: ["smtp.x.test"] });
    expect(r.calls).toContain("A 4.3.2.1.zen.spamhaus.org");
    expect(rep.dnsbl.listed).toEqual([{ zone: "zen.spamhaus.org", target: "smtp.x.test" }]);
    expect(rep.dnsbl.reason).toContain("submission host");
    expect(rep.ptr).toMatchObject({ status: "warn", host: null });
    expect(rep.ptr!.reason).toContain("submission host");
  });
  test("a PTR passes; no SMTP host means ptr null", async () => {
    const rep = await checkDomain(
      fakeResolver(good({ "smtp.x.test": ["1.2.3.4"], "1.2.3.4/PTR": ["smtp.x.test"] })),
      D,
      { ...smtp, smtpHosts: ["smtp.x.test"] },
    );
    expect(rep.ptr).toMatchObject({ status: "pass", host: "smtp.x.test" });
    expect((await check({})).ptr).toBeNull();
  });
});

describe("resolver faults", () => {
  test("ETIMEOUT on TXT -> spf unknown, a warn finding, never a block", async () => {
    const rep = await check({ [`${D}/TXT`]: dnsError("ETIMEOUT") });
    expect(rep.spf.status).toBe("unknown");
    const f = findings(rep).filter((x) => x.reason === "Could not check (DNS unreachable)");
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.level === "warn")).toBe(true);
    expect(findings(rep).some((x) => x.level === "block")).toBe(false);
  });
  test("ENOTFOUND -> No SPF record (fail)", async () => {
    const rep = await checkDomain(fakeResolver({}), D, gm);
    expect(rep.spf).toMatchObject({ status: "fail", reason: "No SPF record" });
  });
  test("SERVFAIL on a nested include is unknown, not a pass", async () => {
    const rep = await check({ "_spf.google.com": dnsError("ESERVFAIL") });
    expect(rep.spf.status).toBe("unknown");
  });
  test("a non-DNS error never escapes", async () => {
    const boom = async (): Promise<never> => {
      throw new TypeError("boom");
    };
    const r = { resolveTxt: boom, resolveMx: boom, resolve4: boom, reverse: boom };
    const rep = await checkDomain(r, D, { ...gm, smtpHosts: ["smtp.x.test"] });
    expect(rep.spf.status).toBe("unknown");
    expect(rep.dnsbl.status).toBe("unknown");
  });
});

describe("review fixes", () => {
  test("one clean zone does not mask an unknown one", async () => {
    const rep = await check({ [`${D}.dbl.spamhaus.org`]: ["127.255.255.254"] });
    expect(rep.dnsbl.status).toBe("unknown");
    expect(rep.dnsbl.reason).toContain("dbl.spamhaus.org");
    expect(rep.dnsbl.listed).toEqual([]);
  });
  test("an IP-literal submission host is not resolved; its reversed IP is queried", async () => {
    const r = fakeResolver(good({ "4.3.2.1.zen.spamhaus.org": ["127.0.0.2"] }));
    const rep = await checkDomain(r, D, { ...smtp, smtpHosts: ["1.2.3.4"] });
    expect(r.calls).not.toContain("A 1.2.3.4");
    expect(rep.dnsbl.listed).toEqual([{ zone: "zen.spamhaus.org", target: "1.2.3.4" }]);
  });
  test("a submission host that cannot be resolved makes the blocklist check unknown", async () => {
    const rep = await check(
      { "smtp.x.test": dnsError("ETIMEOUT") },
      { ...smtp, smtpHosts: ["smtp.x.test"] },
    );
    expect(rep.dnsbl.status).toBe("unknown");
    expect(rep.dnsbl.reason).toContain("smtp.x.test");
  });
  test("a DMARC record without p= is not a pass", async () => {
    const rep = await check({ [`_dmarc.${D}`]: [["v=DMARC1; rua=mailto:a@ex.test"]] });
    expect(rep.dmarc).toMatchObject({
      status: "warn",
      reason: "DMARC record has no policy",
      policy: null,
    });
  });
  test("a null MX fails", async () => {
    const rep = await check({ [`${D}/MX`]: { mx: [{ exchange: ".", priority: 0 }] } });
    expect(rep.mx).toMatchObject({
      status: "fail",
      reason: "Domain accepts no mail (null MX)",
      hosts: [],
    });
  });
  test("an ed25519-only DKIM key has its own warning", async () => {
    const rep = await check({
      [`google._domainkey.${D}`]: [
        ["v=DKIM1; k=ed25519; p=" + Buffer.alloc(32, 1).toString("base64")],
      ],
    });
    expect(rep.dkim.status).toBe("warn");
    expect(rep.dkim.reason).toBe("Only an ed25519 key found; Gmail and Microsoft verify RSA keys");
  });
  test("a resolver that never answers is cut off by the total deadline", async () => {
    const hang = () => new Promise<never>(() => {});
    const r = { resolveTxt: hang, resolveMx: hang, resolve4: hang, reverse: hang };
    const rep = await checkDomain(r, D, { ...gm, smtpHosts: ["smtp.x.test"], deadlineMs: 50 });
    expect(
      [rep.spf, rep.dkim, rep.dmarc, rep.mx, rep.dnsbl, rep.ptr].map((c) => c!.status),
    ).toEqual(Array(6).fill("unknown"));
  });
});

describe("launch gate, DomainCheck and recheck", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let ws: string;
  const clock = fixedClock(new Date("2026-10-20T10:00:00Z"));
  const P = () => db.prisma;
  const deps = (r: ReturnType<typeof fakeResolver>): LaunchDeps => ({
    appUrl: "https://mail.example.com",
    sendable: ["SMTP"],
    contentIssues: async () => [],
    dnsGate: dnsGate(P(), r, clock, ws),
  });
  const codes = (e: unknown) =>
    ((e as CampaignError).body as { issues: { code: string }[] }).issues.map((i) => i.code);
  const row = (domain: string) =>
    P().domainCheck.findUniqueOrThrow({
      where: { workspaceId_domain: { workspaceId: ws, domain } },
    });
  const mkAccount = (email: string, credentialsEnc?: string, extra = {}) =>
    P().emailAccount.create({
      data: {
        workspaceId: ws,
        provider: "SMTP",
        email,
        fromName: "F",
        firstName: "F",
        lastName: "L",
        capTier: "SMTP",
        providerCap: 100,
        credentialsEnc,
        ...extra,
      },
    });
  let n = 0;
  async function ready(email: string, creds?: string) {
    const c = await createCampaign(P(), ws, null, { name: `c${++n}` });
    const a = await mkAccount(email, creds);
    await setCampaignAccounts(P(), ws, null, c.id, [a.id]);
    await setSchedules(P(), ws, null, c.id, { schedules: [{ name: "s", ...PRESETS.officeHours }] });
    return c.id;
  }

  beforeAll(async () => {
    testEnv();
    db = await createTestDb();
    ws = (
      await P().workspace.create({
        data: { name: "W", slug: "w", physicalAddress: "1 Main St" },
      })
    ).id;
  });
  afterAll(() => db.drop());

  test("no SPF -> 422 dns_block; the DomainCheck row records the level", async () => {
    const id = await ready(`a@${D}`);
    const err = await launchCampaign(P(), clock, deps(fakeResolver({})), ws, id, null).catch(
      (e) => e,
    );
    expect(codes(err)).toContain("dns_block");
    expect(await row(D)).toMatchObject({ level: "block" });
  });

  test("DKIM warn only -> 422 dns_warn; override launches with one audit", async () => {
    const id = await ready(`b@${D}`);
    const r = fakeResolver(good({ [`google._domainkey.${D}`]: undefined }));
    expect(codes(await launchCampaign(P(), clock, deps(r), ws, id, null).catch((e) => e))).toEqual([
      "dns_warn",
    ]);
    await expect(
      launchCampaign(P(), clock, deps(r), ws, id, null, { overrideDnsWarnings: true }),
    ).resolves.toMatchObject({ status: "ACTIVE" });
    expect(
      await P().auditLog.count({ where: { workspaceId: ws, action: "campaign.dns_override" } }),
    ).toBe(1);
    expect(await row(D)).toMatchObject({ level: "warn" });
  });

  test("SMTP host comes from the decrypted credentials; only the host name is stored", async () => {
    const m = {
      host: "smtp.x.test",
      port: 465,
      secure: true,
      username: "u",
      password: "SECRET-PW",
    };
    const id = await ready("c@sm.test", encryptCredentials({ kind: "smtp", imap: m, smtp: m }));
    const r = fakeResolver(
      good({
        "sm.test/TXT": [["v=spf1 ip4:1.2.3.4 -all"]],
        "sm.test/MX": { mx: [{ exchange: "m", priority: 1 }] },
        "smtp.x.test": ["1.2.3.4"],
      }),
    );
    await launchCampaign(P(), clock, deps(r), ws, id, null, { overrideDnsWarnings: true });
    expect(r.calls).toContain("A smtp.x.test");
    const stored = JSON.stringify((await row("sm.test")).report);
    expect(stored).toContain("smtp.x.test");
    expect(stored).not.toContain("SECRET-PW");
  });

  test("recheckDomains checks each distinct domain of live accounts once and updates checkedAt", async () => {
    const before = await row(D);
    await mkAccount(`z@${D}`);
    await mkAccount("gone@gone.test", undefined, { deletedAt: new Date() });
    clock.advance(24 * 3600_000);
    const r = fakeResolver(good({ "sm.test/TXT": [["v=spf1 ip4:1.2.3.4 -all"]] }));
    expect(await recheckDomains(P(), clock, r)).toBe(2); // ex.test and sm.test
    expect(r.calls.filter((c) => c === `TXT ${D}`)).toHaveLength(1);
    const after = await row(D);
    expect(after.checkedAt.getTime()).toBeGreaterThan(before.checkedAt.getTime());
    expect(after.level).toBe("ok");
    await expect(
      P().domainCheck.findFirst({ where: { workspaceId: ws, domain: "gone.test" } }),
    ).resolves.toBeNull();
  });
});
