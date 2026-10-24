import { expect, test, type Page } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// E2E #4 (Fake mailboxes, no worker): build a campaign in the UI, preview, hit the launch gate, launch, then work the
// Scheduled emails page on rows the spec seeds (a worker would produce them). Runs after auth.spec.
test.use({ storageState: STATE });
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

// Later specs count leads and accounts in the shared database, so leave none of ours behind.
test.afterAll(async () => {
  const prisma = db();
  await prisma.campaign.deleteMany({ where: { name: "E2E launch" } });
  await prisma.lead.deleteMany({ where: { email: { endsWith: "@e2e-campaign.io" } } });
  await prisma.leadList.deleteMany({ where: { name: "E2E campaign list" } });
  await prisma.emailAccount.deleteMany({ where: { email: "sender@e2e-campaign.test" } });
  await prisma.$disconnect();
});

const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test("create, preview, launch gate, launch, held rows, keyboard", async ({ page }) => {
  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  await prisma.workspace.update({ where: { id: ws }, data: { physicalAddress: null } });
  const account = await prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      email: "sender@e2e-campaign.test",
      fromName: "Sam",
      firstName: "Sam",
      lastName: "Sender",
      capTier: "SMTP",
      providerCap: 100,
    },
  });
  const list = await prisma.leadList.create({
    data: { workspaceId: ws, name: "E2E campaign list" },
  });
  for (const n of ["Ann", "Bob", "Cy"]) {
    const lead = await prisma.lead.create({
      data: { workspaceId: ws, email: `${n.toLowerCase()}@e2e-campaign.io`, firstName: n },
    });
    await prisma.leadListMember.create({ data: { listId: list.id, leadId: lead.id } });
  }

  // create
  await page.goto("/campaigns");
  await page.getByLabel("New campaign name").fill("E2E launch");
  await page.getByRole("button", { name: "Create campaign" }).click();
  await expect(page.getByRole("heading", { name: "E2E launch" })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  const campaignId = page.url().split("/").pop()!;

  // enroll the list: 3 Active
  await page.getByLabel("Lead source").selectOption({ label: "List: E2E campaign list" });
  await page.getByRole("button", { name: "Enroll leads" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Enrolled 3 lead(s)" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Lead status totals" })).toContainText("Active 3");
  await expect(page.getByRole("table", { name: "Campaign leads" }).locator("tbody tr")).toHaveCount(
    3,
  );

  // A/B options (D46): auto-optimize, a metric and the daily reset persist
  await tab(page, "Options").click();
  await page.getByLabel("Auto-optimize A/Z").check();
  await page.getByLabel("Reset variant balance daily").check();
  await page.getByLabel("Winner metric").selectOption({ label: "Open rate (estimated)" });
  await expect(page.getByText("Needs at least 100 sends per variant.")).toBeVisible();
  await page.getByRole("button", { name: "Save options" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Options saved." })).toBeVisible();
  expect(
    await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { abAutoOptimize: true, abResetDaily: true, abWinnerMetric: true },
    }),
  ).toEqual({ abAutoOptimize: true, abResetDaily: true, abWinnerMetric: "open" });

  // sequence: step 1 and step 2, two variants each
  await tab(page, "Sequences").click();
  const variantForm = async (n: "first" | "last", subject: string, body: string) => {
    const s = page.getByLabel("Subject of new variant")[n]();
    await s.fill(subject);
    await page.getByLabel("Body of new variant")[n]().fill(body);
    await page.getByRole("button", { name: "Add variant" })[n]().click();
  };
  await page.getByRole("button", { name: "Add step" }).click();
  await expect(page.getByRole("heading", { name: "Step 1" })).toBeVisible();
  await variantForm("first", "Hello {{firstName}}", "<p>Hi {{firstName}}, quick question.</p>");
  await expect(page.getByRole("group", { name: "Variant A" })).toBeVisible();
  await variantForm("first", "Hey {{firstName}}", "<p>{{firstName}}, do you have a minute?</p>");
  await expect(page.getByRole("group", { name: "Variant B" })).toBeVisible();
  await page.getByRole("button", { name: "Add step" }).click();
  await expect(page.getByRole("heading", { name: "Step 2" })).toBeVisible();
  await variantForm("last", "Re: {{firstName}}", "<p>Following up, {{firstName}}.</p>");
  await expect(page.getByRole("group", { name: "Variant A" })).toHaveCount(2);
  await variantForm(
    "last",
    "Another look, {{firstName}}",
    "<p>Still interested, {{firstName}}?</p>",
  );
  await expect(page.getByRole("group", { name: "Variant B" })).toHaveCount(2);

  // an unknown variable is refused inline
  await page.getByLabel("Subject of new variant").last().fill("Hi {{nope}}");
  await page.getByLabel("Body of new variant").last().fill("x");
  await page.getByRole("button", { name: "Add variant" }).last().click();
  await expect(page.getByRole("alert").filter({ hasText: "Unknown variable" })).toBeVisible();
  await page.getByLabel("Subject of new variant").last().fill("");

  // schedule preset, then the account
  await tab(page, "Schedule").click();
  await page.getByRole("button", { name: "Add schedule" }).click();
  await page.getByRole("button", { name: "Office hours" }).click();
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("Schedule saved.")).toBeVisible();
  await tab(page, "Accounts").click();
  await page.getByLabel("sender@e2e-campaign.test").check();
  await page.getByRole("button", { name: "Save accounts" }).click();
  await expect(page.getByText("Accounts saved.")).toBeVisible();

  // preview shows the lead's first name (and flags the missing address)
  await tab(page, "Sequences").click();
  await page.getByRole("button", { name: "Preview variant A" }).first().click();
  const preview = page.getByRole("dialog", { name: "Preview" });
  await expect(preview.getByTestId("preview-subject")).toHaveText("Hello Ann");
  await expect(preview.frameLocator("iframe").getByText("Hi Ann, quick question.")).toBeVisible();
  await expect(preview.getByRole("alert").filter({ hasText: "physical address" })).toBeVisible();
  await preview.getByRole("button", { name: "Close" }).click();

  // launch gate: no address
  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Add your physical address" }),
  ).toBeVisible();

  // set the address in settings, launch again
  await page.goto("/settings");
  await page.getByLabel("Physical postal address").fill("1 Test Street, Berlin");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto(`/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Campaign status" })).toContainText(
    "Waiting for mailbox sync",
  );
  await expect(tab(page, "Subsequences")).toBeVisible(); // only after launch (PS-CAMP-03)

  // seeded HELD rows
  const step = await prisma.sequenceStep.findFirstOrThrow({ where: { campaignId, order: 1 } });
  const variant = await prisma.stepVariant.findFirstOrThrow({ where: { stepId: step.id } });
  const cls = await prisma.campaignLead.findMany({
    where: { campaignId },
    orderBy: { enrolledAt: "asc" },
  });
  const emails = await prisma.lead.findMany({
    where: { id: { in: cls.map((c) => c.leadId) } },
    orderBy: { createdAt: "asc" },
  });
  for (const [i, cl] of cls.slice(0, 2).entries()) {
    await prisma.campaignLead.update({
      where: { id: cl.id },
      data: { state: "ACTIVE", currentStepId: step.id },
    });
    await prisma.scheduledMessage.create({
      data: {
        workspaceId: ws,
        campaignId,
        campaignLeadId: cl.id,
        stepId: step.id,
        variantId: variant.id,
        accountId: account.id,
        dueAt: new Date(),
        status: "HELD",
        uncertainAt: new Date(),
        searchCount: 2,
        idempotencyKey: `${cl.id}:${step.id}`,
        renderedSubject: `Held subject ${i}`,
        renderedBody: "<p>x</p>",
        renderedText: "x",
        error: "lease_expired",
      },
    });
  }
  const [releaseRow, cancelRow] = [emails[0]!.email, emails[1]!.email];

  await page.goto("/scheduled");
  // keyboard: arrow keys move between tabs
  await tab(page, "Scheduled").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Held")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Held")).toBeFocused();
  await page.keyboard.press("End");
  await expect(tab(page, "Cancelled")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  const held = page.getByRole("table", { name: "Held emails" });
  await expect(held.locator("tbody tr")).toHaveCount(2);
  await expect(held).toContainText("Sent folder searched 2 time(s)");

  // dead-letter view (PS-SEND-17): Failed lists the held rows with their error and Release (admin)
  await tab(page, "Failed").click();
  const dead = page.getByRole("table", { name: "Failed emails" });
  await expect(dead.locator("tbody tr")).toHaveCount(2);
  await expect(dead).toContainText("lease_expired");
  await expect(dead.getByRole("button", { name: `Release email to ${releaseRow}` })).toBeVisible();
  await tab(page, "Held").click();

  // release asks first, traps focus, and "Keep held" changes nothing
  await held.getByRole("button", { name: `Release email to ${releaseRow}` }).click();
  const dialog = page.getByRole("dialog", { name: "Release this email?" });
  await expect(dialog).toContainText(
    "This email may already have been delivered. Releasing can send it a second time.",
  );
  await expect(dialog.getByRole("button", { name: "Keep held" })).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const a = document.activeElement;
      return a === document.body || !!a?.closest("dialog[open]");
    });
    expect(inside).toBe(true);
  }
  await dialog.getByRole("button", { name: "Keep held" }).click();
  await expect(dialog).toBeHidden();
  await expect(held.locator("tbody tr")).toHaveCount(2);

  await held.getByRole("button", { name: `Release email to ${releaseRow}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Release anyway" }).click();
  await expect(held.locator("tbody tr")).toHaveCount(1);
  await tab(page, "Scheduled").click();
  await expect(page.getByRole("table", { name: "Scheduled emails" })).toContainText(releaseRow);

  // cancel: skips the step for the lead, the row moves to Cancelled
  await tab(page, "Held").click();
  await held.getByRole("button", { name: `Cancel email to ${cancelRow}` }).click();
  await expect(held).not.toContainText(cancelRow);
  await tab(page, "Cancelled").click();
  await expect(page.getByRole("table", { name: "Cancelled emails" })).toContainText(cancelRow);

  await prisma.$disconnect();
});
