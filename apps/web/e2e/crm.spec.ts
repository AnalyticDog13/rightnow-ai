import { expect, test } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// E2E #12: a seeded lead with one ACCEPTED send; the board is driven with the lead drawer, the card's Stage select
// (keyboard path), drag and drop, the opportunity drawer, Tasks and Activity. Runs after auth.spec.
test.use({ storageState: STATE });
test.setTimeout(180_000); // cold route compiles under next dev
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);

async function clean() {
  const prisma = db();
  const leads = { lead: { email: { endsWith: "@e2e-crm.io" } } };
  await prisma.task.deleteMany({ where: { OR: [leads, { title: "Stuck task" }] } });
  await prisma.opportunity.deleteMany({ where: leads });
  await prisma.event.deleteMany({ where: { dedupeKey: { startsWith: "crm-e2e:" } } });
  await prisma.campaign.deleteMany({ where: { name: "CRM E2E" } });
  await prisma.lead.deleteMany({ where: { email: { endsWith: "@e2e-crm.io" } } });
  await prisma.emailAccount.deleteMany({ where: { email: { endsWith: "@e2e-crm.test" } } });
  await prisma.$disconnect();
}
test.beforeAll(clean);
test.afterAll(clean);

test("interest creates a card; move by select and drag; tasks; activity", async ({ page }) => {
  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  const account = await prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      email: "sender@e2e-crm.test",
      fromName: "Sam",
      firstName: "Sam",
      lastName: "Sender",
      capTier: "SMTP",
      providerCap: 100,
      credentialsEnc: "x",
    },
  });
  const campaign = await prisma.campaign.create({
    data: { workspaceId: ws, name: "CRM E2E", status: "ACTIVE" },
  });
  const step = await prisma.sequenceStep.create({
    data: { campaignId: campaign.id, order: 1, delayValue: 0 },
  });
  const variant = await prisma.stepVariant.create({
    data: { stepId: step.id, label: "A", subject: "Hi", body: "Hello" },
  });
  const lead = await prisma.lead.create({
    data: { workspaceId: ws, email: "ann@e2e-crm.io", companyName: "Acme CRM" },
  });
  await prisma.lead.create({
    data: { workspaceId: ws, email: "bob@e2e-crm.io", companyName: "Manual Co" },
  });
  await prisma.event.create({
    data: {
      workspaceId: ws,
      type: "ACCEPTED",
      occurredAt: new Date(Date.now() - 3600_000),
      leadId: lead.id,
      campaignId: campaign.id,
      stepId: step.id,
      variantId: variant.id,
      accountId: account.id,
      dedupeKey: "crm-e2e:accepted",
    },
  });
  await prisma.$disconnect();

  // interest "Interested" in the lead drawer -> a card in "Interested"
  await page.goto("/leads");
  await page.getByLabel("Search leads").fill("ann@e2e-crm.io");
  await page.getByRole("row", { name: /ann@e2e-crm\.io/ }).click();
  const leadDrawer = page.getByRole("dialog", { name: "ann@e2e-crm.io" });
  await leadDrawer.getByLabel("Interest status").selectOption({ label: "Interested" });
  const saved = page.waitForResponse(
    (r) => /\/api\/v1\/leads\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH",
  );
  await leadDrawer.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);

  await page.goto("/crm");
  const column = (name: string) => page.getByRole("region", { name, exact: true });
  const card = (name: string) => page.getByRole("listitem").filter({ hasText: name });
  await expect(column("Interested").getByText("Acme CRM")).toBeVisible();
  await expect(card("Acme CRM")).toContainText("CRM E2E");

  // the drawer names the attribution
  await card("Acme CRM").getByRole("button", { name: "Open Acme CRM" }).click();
  const drawer = page.getByRole("dialog", { name: "Acme CRM" });
  await expect(drawer).toContainText("From CRM E2E · step 1 · variant A · sender@e2e-crm.test");
  await drawer.getByRole("button", { name: "Close" }).click();

  // keyboard only: Tab from the card's title to its Stage select, ArrowDown picks the next stage; the move is
  // announced and focus stays on the moved card's Stage select
  const moved = page.waitForResponse(
    (r) => /\/crm\/opportunities\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH",
  );
  const stage = page.getByLabel("Stage of Acme CRM");
  await card("Acme CRM").getByRole("button", { name: "Open Acme CRM" }).focus();
  await page.keyboard.press("Tab");
  await expect(stage).toBeFocused();
  await page.keyboard.press("ArrowDown"); // Interested -> Meeting Scheduled
  expect((await moved).status()).toBe(200);
  await expect(
    page.getByRole("status").filter({ hasText: "Moved Acme CRM to Meeting Scheduled" }),
  ).toBeVisible();
  await expect(column("Meeting Scheduled").getByText("Acme CRM")).toBeVisible();
  await expect(stage).toBeFocused();
  await page.reload();
  await expect(column("Meeting Scheduled").getByText("Acme CRM")).toBeVisible();

  // a rejected move is reported and the card goes back
  const patchUrl = "**/api/v1/crm/opportunities/*";
  await page.route(patchUrl, (r) =>
    r.request().method() === "PATCH"
      ? r.fulfill({ status: 409, contentType: "application/json", body: '{"error":"conflict"}' })
      : r.fallback(),
  );
  await stage.selectOption({ label: "Negotiation" });
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not move Acme CRM" }),
  ).toBeVisible();
  await expect(column("Meeting Scheduled").getByText("Acme CRM")).toBeVisible();
  await page.unroute(patchUrl);

  // the network is down: the move and the reload both fail, and the card still goes back
  const down = "**/api/v1/crm/opportunities**";
  await page.route(down, (r) => r.abort());
  await stage.selectOption({ label: "Negotiation" });
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not move Acme CRM" }),
  ).toBeVisible();
  await expect(column("Meeting Scheduled").getByText("Acme CRM")).toBeVisible();
  await expect(column("Negotiation").getByText("Acme CRM")).toHaveCount(0);
  await page.unroute(down);

  // a manual opportunity, dragged to the next column
  await page.getByRole("button", { name: "New opportunity" }).click();
  const form = page.getByRole("dialog", { name: "New opportunity" });
  await form.getByLabel("Find a lead").fill("bob@e2e-crm.io");
  await form.getByLabel("Lead", { exact: true }).selectOption({ label: "bob@e2e-crm.io" });
  await form.getByLabel("Title").fill("Manual deal");
  await form.getByRole("button", { name: "Create opportunity" }).click();
  await expect(column("Not Contacted").getByText("Manual deal")).toBeVisible();
  const drop = page.waitForResponse(
    (r) => /\/crm\/opportunities\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH",
  );
  await card("Manual deal").dragTo(column("Contacted"), { sourcePosition: { x: 24, y: 5 } });
  expect((await drop).status()).toBe(200);
  await expect(column("Contacted").getByText("Manual deal")).toBeVisible();

  // a task due today, added in the drawer, then completed under Tasks
  await card("Acme CRM").getByRole("button", { name: "Open Acme CRM" }).click();
  const d2 = page.getByRole("dialog", { name: "Acme CRM" });
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  await d2.getByLabel("Task title").fill("Send proposal");
  await d2.getByLabel("Task due").fill(local);
  const made = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/crm/tasks") && r.request().method() === "POST",
  );
  await d2.getByRole("button", { name: "Add task" }).click();
  expect((await made).status()).toBe(200);
  await expect(d2.getByRole("list", { name: "Tasks" })).toContainText("Send proposal");
  await d2.getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Tasks" }).click();
  await page.getByLabel("Due", { exact: true }).selectOption({ label: "Due today" });
  const row = page.getByRole("listitem").filter({ hasText: "Send proposal" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Complete Send proposal" }).click();
  await expect(row).toHaveCount(0);

  // a rejected complete keeps its error on screen after the list reloads
  const stuck = await page.request.post("/api/v1/crm/tasks", {
    data: { title: "Stuck task", dueAt: new Date().toISOString() },
    headers: { origin: "http://localhost:3100" },
  });
  expect(stuck.status()).toBe(200);
  await page.getByLabel("Due", { exact: true }).selectOption({ label: "Any time" });
  await page.getByLabel("Due", { exact: true }).selectOption({ label: "Due today" });
  const taskUrl = "**/api/v1/crm/tasks/*";
  await page.route(taskUrl, (r) =>
    r.request().method() === "PATCH"
      ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' })
      : r.fallback(),
  );
  const stuckRow = page.getByRole("listitem").filter({ hasText: "Stuck task" });
  await stuckRow.getByRole("button", { name: "Complete Stuck task" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "boom" })).toBeVisible();
  await expect(stuckRow).toBeVisible();
  await page.unroute(taskUrl);

  // activity names the move and who made it
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Interested → Meeting Scheduled" })
      .filter({ hasText: "Ada Owner" }),
  ).toBeVisible();

  // the Leads tab is the existing leads view
  await expect(page.getByRole("main").getByRole("link", { name: "Leads" })).toHaveAttribute(
    "href",
    "/leads",
  );
});
