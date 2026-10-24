import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { NAV } from "../lib/nav";
import { ensureSession, STATE } from "./session";

// P7-T08a: nav smoke, axe on every section (light and dark), keyboard, table and tag conventions, saved lead filters.
// A seeded workspace has data in every section. Runs after auth.spec.
test.use({ storageState: STATE });
test.setTimeout(180_000); // cold route compiles under next dev
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);
const SUFFIX = "e2e-a11y";
const num = (i: number) => String(i).padStart(2, "0");
const origin = "http://localhost:3100";

async function clean() {
  const prisma = db();
  const leads = { lead: { email: { endsWith: `@${SUFFIX}.io` } } };
  await prisma.task.deleteMany({ where: { OR: [leads, { title: { startsWith: "A11y task" } }] } });
  await prisma.opportunity.deleteMany({ where: leads });
  await prisma.event.deleteMany({ where: { dedupeKey: { startsWith: "a11y-e2e:" } } });
  await prisma.thread.deleteMany({ where: { subject: "A11y thread" } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: "A11y" } } });
  await prisma.lead.deleteMany({ where: { email: { endsWith: `@${SUFFIX}.io` } } });
  await prisma.emailAccount.deleteMany({ where: { email: { endsWith: `@${SUFFIX}.test` } } });
  await prisma.suppression.deleteMany({ where: { valueHash: { startsWith: "a11y-hash-" } } });
  await prisma.leadLabel.deleteMany({ where: { name: "a11y-label" } });
  await prisma.inboxView.deleteMany({ where: { name: "My filter" } });
  await prisma.$disconnect();
}

test.beforeAll(async () => {
  await clean();
  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  const many = Array.from({ length: 27 }, (_, i) => i + 1);
  const lots = Array.from({ length: 55 }, (_, i) => i + 1);

  await prisma.emailAccount.createMany({
    data: many.map((i) => ({
      workspaceId: ws,
      provider: "SMTP" as const,
      email: `acct${num(i)}@${SUFFIX}.test`,
      fromName: "Sam",
      firstName: "Sam",
      lastName: "Sender",
      capTier: "SMTP" as const,
      providerCap: 100,
      credentialsEnc: "x",
      tags: i === 1 ? ["eu"] : [],
    })),
  });
  const account = await prisma.emailAccount.findFirstOrThrow({
    where: { email: `acct01@${SUFFIX}.test` },
  });
  const campaign = await prisma.campaign.create({
    data: { workspaceId: ws, name: "A11y main", status: "ACTIVE", tags: ["eu"] },
  });
  await prisma.campaign.createMany({
    data: many.map((i) => ({ workspaceId: ws, name: `A11y campaign ${num(i)}` })),
  });
  const step = await prisma.sequenceStep.create({
    data: { campaignId: campaign.id, order: 1, delayValue: 0 },
  });
  const variant = await prisma.stepVariant.create({
    data: { stepId: step.id, label: "A", subject: "Hi", body: "Hello" },
  });
  await prisma.lead.createMany({
    data: lots.map((i) => ({
      workspaceId: ws,
      email: `lead${num(i)}@${SUFFIX}.io`,
      firstName: "Lead",
      companyName: `Co ${num(i)}`,
      tags: i === 1 ? ["eu"] : [],
    })),
  });
  const leads = await prisma.lead.findMany({ where: { email: { endsWith: `@${SUFFIX}.io` } } });
  await prisma.campaignLead.createMany({
    data: leads.map((l) => ({
      workspaceId: ws,
      campaignId: campaign.id,
      leadId: l.id,
      state: "ACTIVE" as const,
      currentStepId: step.id,
    })),
  });
  const cls = await prisma.campaignLead.findMany({ where: { campaignId: campaign.id } });
  const byId = new Map(leads.map((l) => [l.id, l]));
  await prisma.scheduledMessage.createMany({
    data: cls.map((cl) => ({
      workspaceId: ws,
      campaignId: campaign.id,
      campaignLeadId: cl.id,
      stepId: step.id,
      variantId: variant.id,
      accountId: account.id,
      idempotencyKey: `${cl.id}:${step.id}`,
      renderedSubject: "Hi",
      renderedBody: "<p>Hello</p>",
      renderedText: "Hello",
      dueAt: new Date(Date.now() + 86_400_000),
      status: "SCHEDULED" as const,
      cc: [],
      bcc: [],
    })),
  });
  await prisma.suppression.createMany({
    data: lots.map((i) => ({
      workspaceId: ws,
      kind: "EMAIL" as const,
      value: `blocked${num(i)}@${SUFFIX}.io`,
      valueHash: `a11y-hash-${i}`,
      reason: "MANUAL" as const,
    })),
  });
  await prisma.task.createMany({
    data: many.map((i) => ({ workspaceId: ws, title: `A11y task ${num(i)}` })),
  });
  await prisma.leadLabel.create({
    data: { workspaceId: ws, name: "a11y-label", color: "#3b82f6", aiSelectable: true },
  });
  const first = leads.find((l) => l.email === `lead01@${SUFFIX}.io`)!;
  await prisma.event.createMany({
    data: [..."AAAAARR"].map((t, i) => ({
      workspaceId: ws,
      type: t === "A" ? ("ACCEPTED" as const) : ("REPLY" as const),
      occurredAt: new Date(Date.now() - (i + 1) * 3600_000),
      leadId: cls[i] ? byId.get(cls[i]!.leadId)!.id : first.id,
      campaignId: campaign.id,
      stepId: step.id,
      variantId: variant.id,
      accountId: account.id,
      dedupeKey: `a11y-e2e:${i}`,
    })),
  });
  const thread = await prisma.thread.create({
    data: {
      workspaceId: ws,
      accountId: account.id,
      subject: "A11y thread",
      leadId: first.id,
      campaignId: campaign.id,
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      lastInboundKind: "REPLY",
    },
  });
  await prisma.message.create({
    data: {
      workspaceId: ws,
      accountId: account.id,
      threadId: thread.id,
      subject: "A11y thread",
      sentAt: new Date(),
      references: [],
      rfcMessageId: "<a11y-in@e2e.test>",
      direction: "IN",
      folder: "INBOX",
      fromEmail: first.email,
      to: [account.email],
      cc: [],
      kind: "REPLY",
      text: "Sounds good, tell me more.",
      leadId: first.id,
    },
  });
  await prisma.$disconnect();
});
test.afterAll(clean);

test.beforeAll(async ({ playwright, baseURL }) => {
  await ensureSession(playwright, baseURL!);
  const api = await playwright.request.newContext({ baseURL, storageState: STATE });
  const lead = await api.get("/api/v1/leads?q=lead01@");
  const leadId = ((await lead.json()) as { leads: { id: string }[] }).leads[0]!.id;
  const r = await api.post("/api/v1/crm/opportunities", {
    data: { leadId, title: "A11y deal" },
    headers: { origin },
  });
  expect(r.ok()).toBe(true);
  await api.dispose();
});

// ---- helpers
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", (e) => list.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && list.push(`console: ${m.text()}`));
});

/** serious and critical WCAG A/AA violations fail; every finding is logged so the counts are visible. */
async function axe(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  for (const v of r.violations)
    console.log(
      `AXE ${name}: ${v.id} (${v.impact}) x${v.nodes.length} ${v.nodes[0]?.target.join(" ")}`,
    );
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    name,
  ).toEqual([]);
}

/** Scans the tab that is showing, then each of the other tabs. */
async function axeTabs(page: Page, name: string) {
  const tabs = await page.getByRole("tab").allInnerTexts();
  await axe(page, name);
  for (const t of tabs) {
    await page.getByRole("tab", { name: t, exact: true }).click();
    await page.waitForLoadState("networkidle");
    await axe(page, `${name} / ${t}`);
  }
}

const rows = (page: Page) => page.locator("tbody tr");

test("nav smoke: each section opens with a heading, no placeholder text and no console errors", async ({
  page,
}) => {
  await page.goto("/dashboard");
  for (const { href, label } of NAV) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByText(/arrives/i)).toHaveCount(0);
  }
  expect(errors.get(page)).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    for (const { href, label } of NAV)
      test(`${label} page`, async ({ page }) => {
        await page.goto(href);
        await expect(page.locator("h1").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        if (["/crm", "/automations"].includes(href)) await axeTabs(page, `${label} ${scheme}`);
        else await axe(page, `${label} ${scheme}`);
      });

    for (const [name, path] of [
      ["Lead lists", "/leads/lists"],
      ["Blocklist", "/blocklist"],
      ["Scheduled emails", "/scheduled"],
      ["Placement tests", "/deliverability/placement"],
      ["API keys", "/settings/api-keys"],
    ])
      test(`${name} page`, async ({ page }) => {
        await page.goto(path!);
        await page.waitForLoadState("networkidle");
        await axe(page, `${name} ${scheme}`);
      });

    test("opportunity drawer", async ({ page }) => {
      await page.goto("/crm");
      await page
        .getByRole("button", { name: /^Open / })
        .first()
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await axe(page, `Opportunity drawer ${scheme}`);
    });

    test("campaign builder, every tab", async ({ page }) => {
      await page.goto("/campaigns");
      await page.getByLabel("Search campaigns").fill("A11y main");
      await page.getByRole("link", { name: "A11y main" }).click();
      await expect(page.getByRole("tab").first()).toBeVisible();
      await axeTabs(page, `Campaign builder ${scheme}`);
    });

    test("rule editor and webhook form", async ({ page }) => {
      await page.goto("/automations");
      await page.getByRole("button", { name: "New rule" }).click();
      await expect(page.getByRole("form", { name: "New rule" })).toBeVisible();
      await axe(page, `Rule editor ${scheme}`);
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("tab", { name: "Webhooks" }).click();
      await page.getByRole("button", { name: "New webhook" }).click();
      await expect(page.getByRole("form", { name: "New webhook" })).toBeVisible();
      await axe(page, `Webhook form ${scheme}`);
    });

    test("inbox thread", async ({ page }) => {
      await page.goto("/inbox");
      await page.getByRole("button", { name: /A11y thread/ }).click();
      await expect(page.getByText("Sounds good, tell me more.")).toBeVisible();
      await axe(page, `Inbox thread ${scheme}`);
    });

    test("lead drawer", async ({ page }) => {
      await page.goto("/leads");
      await page.getByRole("row", { name: /lead01@/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await axe(page, `Lead drawer ${scheme}`);
    });
  });
}

test.describe("keyboard", () => {
  test("Tab reaches the skip link, then the navigation; the skip link moves to the content", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link").first(),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  async function trapsFocus(page: Page, dialog: Locator) {
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      // a native modal dialog hands focus to the browser chrome (body) at its end; it never reaches the page behind
      expect(
        await dialog.evaluate(
          (d) => d.contains(document.activeElement) || document.activeElement === document.body,
        ),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }

  test("dialogs trap focus and Escape closes them", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("row", { name: /lead01@/ }).click();
    await trapsFocus(page, page.getByRole("dialog"));
    await page.goto("/crm");
    await page
      .getByRole("button", { name: /^Open / })
      .first()
      .click();
    await trapsFocus(page, page.getByRole("dialog"));
  });

  test("a Kanban card moves with the keyboard", async ({ page }) => {
    await page.goto("/crm");
    const stage = page.getByLabel(/^Stage of /).first();
    await page
      .getByRole("button", { name: /^Open / })
      .first()
      .focus();
    await page.keyboard.press("Tab");
    await expect(stage).toBeFocused();
    const moved = page.waitForResponse(
      (r) => /\/crm\/opportunities\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH",
    );
    await page.keyboard.press("ArrowDown");
    expect((await moved).status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: /^Moved / })).toBeVisible();
  });

  test("the webhook form and the rule editor take focus when they open and give it back", async ({
    page,
  }) => {
    await page.goto("/automations");
    const newRule = page.getByRole("button", { name: "New rule" });
    await newRule.click();
    await expect(page.getByRole("heading", { name: "New rule" })).toBeFocused();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(newRule).toBeFocused();
    await page.getByRole("tab", { name: "Webhooks" }).click();
    const newHook = page.getByRole("button", { name: "New webhook" });
    await newHook.click();
    await expect(page.getByRole("heading", { name: "New webhook" })).toBeFocused();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(newHook).toBeFocused();
  });
});

test.describe("tables", () => {
  /** search narrows, one header click sets aria-sort, 2 selected rows show the bulk bar with the count */
  async function conventions(page: Page, o: { search: string; term: string; sortBy: string }) {
    const before = await rows(page).count();
    await page.getByLabel(o.search).fill(o.term);
    await expect(rows(page)).toHaveCount(1);
    expect(before).toBeGreaterThan(1);
    await page.getByLabel(o.search).fill("");
    await expect.poll(() => rows(page).count()).toBeGreaterThan(1);

    const th = page.getByRole("columnheader", { name: o.sortBy, exact: true });
    await expect(th).toHaveAttribute("aria-sort", "none");
    await th.getByRole("button").click();
    await expect(th).toHaveAttribute("aria-sort", "ascending");
    await th.getByRole("button").click();
    await expect(th).toHaveAttribute("aria-sort", "descending");

    const boxes = rows(page).getByRole("checkbox");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(page.getByRole("toolbar", { name: "Bulk actions" })).toContainText("2 selected");
  }
  const next = (page: Page) => page.getByRole("button", { name: /^Next page$/ });

  test("Accounts", async ({ page }) => {
    await page.goto("/accounts");
    await expect(next(page)).toBeVisible(); // 27 accounts, 25 per page
    await conventions(page, { search: "Search accounts", term: "acct07@", sortBy: "Email" });
    await next(page).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
  });

  test("Campaigns", async ({ page }) => {
    await page.goto("/campaigns");
    await expect(next(page)).toBeVisible();
    await conventions(page, {
      search: "Search campaigns",
      term: "campaign 07",
      sortBy: "Campaign",
    });
  });

  test("Leads", async ({ page }) => {
    await page.goto("/leads");
    await expect(next(page)).toBeVisible(); // 55 leads, 50 per page
    await conventions(page, { search: "Search leads", term: "lead07@", sortBy: "Email" });
    await page.getByLabel("Search leads").fill("");
    // the sort is the server's: descending puts the last of all 55 first, though only 50 are loaded
    await expect(rows(page).first()).toContainText("lead55@");
    await next(page).click();
    await expect(page.getByText(/Showing 55/)).toBeVisible();
  });

  test("Blocklist", async ({ page }) => {
    await page.goto("/blocklist");
    await expect(next(page)).toBeVisible();
    await conventions(page, { search: "Search blocklist", term: "blocked07@", sortBy: "Value" });
    await expect(page.getByText("Sorted within the 50 rows loaded.")).toBeVisible();
  });

  test("Scheduled", async ({ page }) => {
    await page.goto("/scheduled");
    await expect(next(page)).toBeVisible();
    await conventions(page, {
      search: "Search scheduled emails",
      term: "lead07@",
      sortBy: "Lead",
    });
    await expect(page.getByText("Sorted within the 50 rows loaded.")).toBeVisible();
  });

  test("CRM Tasks", async ({ page }) => {
    await page.goto("/crm?tab=tasks");
    await expect(next(page)).toBeVisible();
    await conventions(page, { search: "Search tasks", term: "task 07", sortBy: "Task" });
  });

  test("Leads: a saved filter is saved, reloaded and applied", async ({ page }) => {
    await page.goto("/leads");
    await page.getByLabel("Search leads").fill("lead07@");
    await expect(rows(page)).toHaveCount(1);
    await page.getByLabel("Saved filter name").fill("My filter");
    await page.getByRole("button", { name: "Save filter" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved filter My filter" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Search leads")).toHaveValue("");
    await page.getByLabel("Saved filters").selectOption({ label: "My filter" });
    await expect(page.getByLabel("Search leads")).toHaveValue("lead07@");
    await expect(rows(page)).toHaveCount(1);
    page.once("dialog", (d) => void d.accept()); // asks before deleting
    await page.getByRole("button", { name: "Delete saved filter" }).click();
    await expect(page.getByRole("option", { name: "My filter" })).toHaveCount(0);
  });
});

test("tags: filtering by eu shows only the tagged rows on Accounts, Campaigns and Leads", async ({
  page,
}) => {
  for (const [path, tagged] of [
    ["/accounts", "acct01@"],
    ["/campaigns", "A11y main"],
    ["/leads", "lead01@"],
  ] as const) {
    await page.goto(path);
    await expect.poll(() => rows(page).count()).toBeGreaterThan(1);
    if (path === "/leads") await page.getByText("More filters").click(); // the tag filter sits in the folded part
    await page.getByLabel("Filter by tag").selectOption("eu");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(tagged);
  }
});

test("labels: the editor offers 'AI may choose' and a description", async ({ page }) => {
  await page.goto("/settings");
  const label = page
    .getByRole("list", { name: "Labels" })
    .getByRole("listitem")
    .filter({ hasText: "a11y-label" });
  await expect(label.getByLabel("AI may choose")).toBeChecked();
  const saved = page.waitForResponse(
    (r) => /\/lead-labels\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH",
  );
  await label.getByLabel("AI description for a11y-label").fill("Wants a demo");
  await label.getByLabel("AI description for a11y-label").blur();
  expect((await saved).status()).toBe(200);
});
