import { expect, test, type Page } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { buildMime, getFakeProvider, newMessageId } from "@rightnow/providers";
import { ensureSession, STATE } from "./session";

// E2E #11 (Fake mailboxes, no worker): a campaign send and a lead's reply are seeded, one sync (the dev route) imports
// them, then the inbox UI is driven. Runs after auth.spec.
test.use({ storageState: STATE });
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const ACCOUNT = "inbox@e2e-inbox.test";
const LEAD = "ann@e2e-inbox.io";
const REMOTE = "https://tracker.e2e-remote.test";
const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);

test.afterAll(async () => {
  const prisma = db();
  const acct = await prisma.emailAccount.findFirst({ where: { email: ACCOUNT } });
  if (acct) {
    await prisma.note.deleteMany({ where: { thread: { accountId: acct.id } } });
    await prisma.thread.deleteMany({ where: { accountId: acct.id } });
    await prisma.event.deleteMany({ where: { accountId: acct.id } });
  }
  await prisma.campaign.deleteMany({ where: { name: "E2E inbox" } });
  await prisma.lead.deleteMany({ where: { email: LEAD } });
  await prisma.emailAccount.deleteMany({ where: { email: ACCOUNT } });
  await prisma.$disconnect();
});

const sync = async (page: Page) => {
  const r = await page.request.post("/api/v1/_fake/sync", {
    headers: { origin: "http://localhost:3100" },
  });
  expect(r.status()).toBe(200);
};

test("thread, reply with attachment, inert rendering, notes, bulk unread, reminder", async ({
  page,
}) => {
  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  const account = await prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      email: ACCOUNT,
      fromName: "Sam",
      firstName: "Sam",
      lastName: "Sender",
      capTier: "SMTP",
      providerCap: 100,
      credentialsEnc: "x",
    },
  });
  const campaign = await prisma.campaign.create({
    data: { workspaceId: ws, name: "E2E inbox", status: "ACTIVE" },
  });
  const step = await prisma.sequenceStep.create({
    data: { campaignId: campaign.id, order: 1, delayValue: 0 },
  });
  const variant = await prisma.stepVariant.create({
    data: { stepId: step.id, label: "A", subject: "Quick question", body: "Hello" },
  });
  const lead = await prisma.lead.create({
    data: { workspaceId: ws, email: LEAD, firstName: "Ann", companyName: "Acme" },
  });
  const cl = await prisma.campaignLead.create({
    data: {
      workspaceId: ws,
      campaignId: campaign.id,
      leadId: lead.id,
      state: "ACTIVE",
      currentStepId: step.id,
    },
  });
  const sentAt = new Date(Date.now() - 3600_000);
  const rfc = newMessageId("e2e-inbox.test");
  await prisma.scheduledMessage.create({
    data: {
      workspaceId: ws,
      campaignId: campaign.id,
      campaignLeadId: cl.id,
      stepId: step.id,
      variantId: variant.id,
      accountId: account.id,
      idempotencyKey: `${cl.id}:${step.id}`,
      renderedSubject: "Quick question",
      renderedBody: "<p>Hello Ann</p>",
      renderedText: "Hello Ann",
      dueAt: sentAt,
      sentAt,
      status: "SENT",
      rfcMessageId: rfc,
    },
  });
  await prisma.$disconnect();

  const box = getFakeProvider(ACCOUNT, "SMTP");
  await box.receiveRaw(
    await buildMime({
      from: { email: ACCOUNT, name: "Sam" },
      to: [{ email: LEAD }],
      subject: "Quick question",
      html: "<p>Hello Ann</p>",
      text: "Hello Ann",
      messageId: rfc,
      date: sentAt,
    }),
    "SENT",
  );
  await sync(page); // the first sync is the historical import (imported mail is read); the reply below is new
  await box.receiveRaw(
    await buildMime({
      from: { email: LEAD, name: "Ann" },
      to: [{ email: ACCOUNT }],
      subject: "Re: Quick question",
      text: "Sounds interesting, tell me more.",
      messageId: newMessageId("e2e-inbox.io"),
      inReplyTo: rfc,
      references: [rfc],
      date: new Date(),
    }),
  );
  await sync(page);

  // Primary with the unread badge
  await page.goto("/inbox");
  const item = page.getByRole("list", { name: "Conversations" }).getByRole("listitem");
  await expect(item).toHaveCount(1);
  await expect(item.getByText("Unread", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByLabel("1 unread")).toBeVisible();

  // opening marks it read; both messages in order; the lead panel names step and variant
  await item.getByRole("button", { name: /Quick question/ }).click();
  const conv = page.getByRole("region", { name: "Conversation" });
  const msgs = conv.getByRole("article");
  await expect(msgs).toHaveCount(2);
  await expect(msgs.nth(0)).toHaveAccessibleName(/Message from Sam/);
  await expect(msgs.nth(1)).toHaveAccessibleName(/Message from Ann/);
  await expect(msgs.nth(1)).toContainText("Sounds interesting");
  const panel = page.getByRole("complementary", { name: "Lead" });
  await expect(panel).toContainText("Step 1");
  await expect(panel).toContainText("Variant A");
  await expect(item.getByText("Unread", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("1 unread")).toHaveCount(0);

  // reply with an attachment: threaded in the Fake's SENT, three messages
  await conv.getByLabel("Reply", { exact: true }).fill("Happy to share details.");
  await conv.getByLabel("Attachments").setInputFiles({
    name: "details.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("the details"),
  });
  await conv.getByRole("button", { name: "Send reply" }).click();
  await expect(conv.getByRole("status")).toContainText("Reply sent");
  await expect(msgs).toHaveCount(3);
  const mb = (await (await page.request.get(`/api/v1/_fake/mailbox/${ACCOUNT}`)).json()) as {
    sent: { subject: string; headers: Record<string, string[]> }[];
  };
  const mine = mb.sent.find((m) => m.subject === "Re: Quick question")!;
  expect(mine.headers["in-reply-to"]?.[0]).toBeTruthy();

  // notes survive a reload
  await conv.getByLabel("New note").fill("Call her on Friday");
  await conv.getByRole("button", { name: "Add note" }).click();
  await expect(conv.getByText("Call her on Friday")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Quick question/ }).click();
  await expect(page.getByText("Call her on Friday")).toBeVisible();

  // reminder puts the thread in Reminders
  await page.getByLabel("Reminder", { exact: true }).fill("2030-01-01T09:00");
  await page.getByRole("button", { name: "Set reminder" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Reminder set" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Inbox views" })
    .getByRole("button", { name: /^Reminders/ })
    .click();
  await expect(page.getByRole("button", { name: /Quick question/ })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Inbox views" })
    .getByRole("button", { name: /^Primary/ })
    .click();

  // bulk mark unread
  await page.getByLabel("Select Quick question").check();
  await page.getByRole("button", { name: "Mark unread" }).click();
  await expect(
    page.getByRole("list", { name: "Conversations" }).getByText("Unread", { exact: true }),
  ).toBeVisible();

  // rendering is inert (Review Focus 4)
  const hostile = `<html><head><meta http-equiv="refresh" content="0;url=${REMOTE}/refresh"><base href="${REMOTE}/">
<style>@import url(${REMOTE}/import.css); body{background:url(${REMOTE}/bg.png)}</style></head><body>
<p id="hello">Hostile hello</p><script>window.__pwned=1</script><img src="x" onerror="window.__pwned=2">
<img id="px" src="${REMOTE}/pixel.png"><form action="${REMOTE}/post" method="post"><input name="a"></form>
<a href="javascript:window.__pwned=3">click</a></body></html>`;
  await box.receiveRaw(
    await buildMime({
      from: { email: "stranger@e2e-inbox.io" },
      to: [{ email: ACCOUNT }],
      subject: "Hostile message",
      html: hostile,
      text: "Hostile text",
      messageId: newMessageId("e2e-inbox.io"),
      date: new Date(),
    }),
  );
  const remote: string[] = [];
  await page.route(`${REMOTE}/**`, (r) => {
    remote.push(r.request().url());
    return r.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) });
  });
  await sync(page);
  await page
    .getByRole("navigation", { name: "Inbox views" })
    .getByRole("button", { name: /^All/ })
    .click();
  await page.getByRole("button", { name: /Hostile message/ }).click();
  const frame = page.locator("iframe[title='Message body']");
  await expect(frame).toHaveAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  const inner = page.frameLocator("iframe[title='Message body']");
  await expect(inner.locator("#hello")).toBeVisible();
  const handle = await frame.elementHandle();
  const cf = (await handle!.contentFrame())!;
  expect(
    await cf.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  await page.waitForTimeout(1000);
  expect(remote).toEqual([]);
  await page.getByRole("button", { name: "Show images" }).click();
  await expect.poll(() => remote.some((u) => u.endsWith("/pixel.png"))).toBe(true);
  expect(remote.some((u) => /refresh|import\.css|post/.test(u))).toBe(false);
});
