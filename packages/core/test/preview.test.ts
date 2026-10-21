import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider } from "@rightnow/providers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { campaignOverview } from "../src/campaigns/service";
import { listLeads } from "../src/leads/service";
import { previewMessage } from "../src/campaigns/preview";
import { sendTestEmail } from "../src/accounts/test-send";
import { fixedClock } from "../src/clock";
import { resetEnvCache } from "../src/env";
import { testEnv } from "./accounts-fixture";
import { seedCampaign } from "./campaign-fixture";

let db: Awaited<ReturnType<typeof createTestDb>>;
const at = new Date("2026-10-20T10:00:00Z");
const env = { appUrl: "https://app.example.com", unsubscribeKeys: [Buffer.alloc(32, 1)] };

beforeAll(async () => {
  testEnv();
  process.env.MAIL_PROVIDER_FAKE = "1";
  process.env.FAKE_MAIL_DIR = mkdtempSync(join(tmpdir(), "rn-pv-"));
  resetEnvCache();
  db = await createTestDb();
});
afterAll(() => db.drop());

async function seed(subject: string, body: string, workspace = {}) {
  const s = await seedCampaign(db.prisma, { at, leads: 1, workspace });
  await db.prisma.stepVariant.update({
    where: { id: s.steps[0]!.variant.id },
    data: { subject, body },
  });
  await db.prisma.lead.update({ where: { id: s.leads[0]!.lead.id }, data: { firstName: "Ann" } });
  return {
    s,
    p: {
      campaignId: s.campaign.id,
      stepId: s.steps[0]!.id,
      variantId: s.steps[0]!.variant.id,
      leadId: s.leads[0]!.lead.id,
    },
  };
}

describe("previewMessage", () => {
  test("renders the lead's first name, the footer with the address and a dead unsubscribe link (gate M-5)", async () => {
    const { s, p } = await seed("Hello {{firstName}}", "<p>Hi {{firstName | there}}</p>");
    const r = await previewMessage(db.prisma, s.ws, p, env);
    expect(r.subject).toBe("Hello Ann");
    expect(r.text).toContain("Hi Ann");
    expect(r.html).toContain("1 Main St");
    expect(r.text).toContain("Unsubscribe: (unsubscribe disabled in test emails)");
    expect(r.html).not.toContain("/u/");
    expect(r.issues).toEqual([]);
  });

  test("an unknown variable is an issue, not a throw", async () => {
    const { s, p } = await seed("Hi", "<p>{{nope}}</p>");
    const r = await previewMessage(db.prisma, s.ws, p, env);
    expect(r.issues[0]!.code).toBe("unknown_variable");
  });

  test("an empty physical address is reported as an issue and the preview still renders", async () => {
    const { s, p } = await seed("Hi", "<p>Body</p>");
    await db.prisma.workspace.update({ where: { id: s.ws }, data: { physicalAddress: null } });
    const r = await previewMessage(db.prisma, s.ws, p, env);
    expect(r.issues.map((i) => i.code)).toContain("physical_address_required");
    expect(r.text).toContain("Body");
  });

  test("a blank follow-up subject replies to the first sent email; with none it is a readable issue", async () => {
    const { s, p } = await seed("", "<p>Body</p>");
    const none = await previewMessage(db.prisma, s.ws, p, env);
    expect(none.issues[0]!.message).toContain("no earlier email");
    await db.prisma.scheduledMessage.create({
      data: {
        workspaceId: s.ws,
        campaignId: s.campaign.id,
        campaignLeadId: s.leads[0]!.cl.id,
        stepId: s.steps[0]!.id,
        variantId: p.variantId,
        accountId: s.accounts[0]!.id,
        dueAt: at,
        status: "SENT",
        sentAt: at,
        idempotencyKey: "prior-1",
        renderedSubject: "Original",
        renderedBody: "x",
        renderedText: "x",
      },
    });
    expect((await previewMessage(db.prisma, s.ws, p, env)).subject).toBe("Re: Original");
  });

  test("an invalid account email is a readable issue, not a raw code", async () => {
    const { s, p } = await seed("Hi", "<p>Body</p>");
    await db.prisma.emailAccount.update({
      where: { id: s.accounts[0]!.id },
      data: { email: "bad<x>@send.test" },
    });
    await db.prisma.emailAccount.update({
      where: { id: s.accounts[1]!.id },
      data: { createdAt: new Date(2100, 0, 1) },
    });
    const r = await previewMessage(db.prisma, s.ws, p, env);
    expect(r.issues.map((i) => i.message).join()).not.toContain("invalid_account_email");
    expect(r.issues[0]!.message).toContain("not a plain email address");
  });

  test("a foreign workspace gets 404", async () => {
    const { p } = await seed("Hi", "x");
    const other = await db.prisma.workspace.create({ data: { name: "O", slug: "o-pv" } });
    await expect(previewMessage(db.prisma, other.id, p, env)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("sendTestEmail with content", () => {
  test("sends the given subject, marked as a test, with no usage row", async () => {
    const s = await seedCampaign(db.prisma, { at });
    const a = s.accounts[0]!;
    await db.prisma.emailAccount.update({
      where: { id: a.id },
      data: {
        provider: "GMAIL",
        credentialsEnc: (await import("../src/accounts/credentials")).encryptCredentials({
          kind: "oauth",
          accessToken: "a",
          refreshToken: "r",
          expiresAt: 1,
          scope: "s",
        }),
      },
    });
    await sendTestEmail(
      db.prisma,
      fixedClock(at),
      {},
      {
        workspaceId: s.ws,
        accountId: a.id,
        to: "t@dest.example",
        confirmAuthorized: true,
        content: { subject: "Hello Ann", html: "<p>Hi Ann</p>", text: "Hi Ann" },
      },
    );
    const [m] = (
      await getFakeProvider(a.email).listMessages({ since: new Date(0), folder: "SENT" })
    ).messages;
    expect(m!.subject).toBe("Hello Ann");
    expect(m!.text).toContain("Hi Ann");
    expect(m!.headers["x-rightnow-test"]).toEqual(["1"]);
    expect(await db.prisma.accountDailyUsage.count({ where: { accountId: a.id } })).toBe(0);
  });
});

describe("campaign list data", () => {
  test("overview counts leads and today's sends; the lead list carries the campaign status", async () => {
    const s = await seedCampaign(db.prisma, { at, leads: 2 });
    await db.prisma.campaignLead.update({
      where: { id: s.leads[1]!.cl.id },
      data: { state: "STOPPED", stopReason: "UNSUBSCRIBED" },
    });
    await db.prisma.campaignDailyUsage.create({
      data: { campaignId: s.campaign.id, day: new Date("2026-10-20T00:00:00Z"), sent: 3 },
    });
    const row = (await campaignOverview(db.prisma, s.ws, at)).find((c) => c.id === s.campaign.id);
    expect(row).toMatchObject({ status: "Active", total: 2, completed: 1, sentToday: 3 });
    const { leads } = await listLeads(db.prisma, s.ws, { campaignId: s.campaign.id });
    expect(leads.map((l) => l.campaignStatus).sort()).toEqual(["Active", "Unsubscribed"]);
  });
});
