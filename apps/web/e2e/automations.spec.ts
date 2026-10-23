import { expect, test } from "@playwright/test";
import { dispatchEvents, systemClock } from "@rightnow/core";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// E2E #13 (no worker): a rule is built in the UI, a REPLY Event is seeded, one dispatch pass runs the job's function
// directly, then the Runs tab, CRM Tasks and the Built-in tab are checked. Runs after auth.spec.
test.use({ storageState: STATE });
test.setTimeout(180_000); // cold route compiles under next dev
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);
const TITLE = "E2E follow up";

async function clean() {
  const prisma = db();
  await prisma.task.deleteMany({ where: { title: TITLE } });
  await prisma.automationRule.deleteMany({ where: { name: "E2E reply task" } });
  await prisma.event.deleteMany({ where: { dedupeKey: { startsWith: "auto-e2e:" } } });
  await prisma.lead.deleteMany({ where: { email: { endsWith: "@e2e-auto.io" } } });
  await prisma.$disconnect();
}
test.beforeAll(clean);
test.afterAll(clean);

test("a rule created in the UI runs on a reply; built-ins show their reasons", async ({ page }) => {
  await page.goto("/automations");
  await page.getByRole("button", { name: "New rule" }).click();
  await page.getByLabel("Name", { exact: true }).fill("E2E reply task");
  await page.getByLabel("When").selectOption({ label: "Reply received" });
  await page.getByLabel("Then 1").selectOption({ label: "Create task" });
  await page.getByLabel("Title").fill(TITLE);
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByRole("table", { name: "Rules" })).toContainText("E2E reply task");

  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  const lead = await prisma.lead.create({ data: { workspaceId: ws, email: "ann@e2e-auto.io" } });
  await prisma.event.create({
    data: {
      workspaceId: ws,
      type: "REPLY",
      occurredAt: new Date(),
      leadId: lead.id,
      dedupeKey: "auto-e2e:reply",
    },
  });
  await dispatchEvents(prisma, systemClock, { maxMs: 1 });
  await prisma.$disconnect();

  await page.reload();
  await page.getByRole("tab", { name: "Runs" }).click();
  await page.getByLabel("Rule").selectOption({ label: "E2E reply task" });
  await expect(page.getByRole("table", { name: "Runs" })).toContainText("OK");

  await page.goto("/crm?tab=tasks");
  await expect(page.getByRole("list", { name: "Task list" })).toContainText(TITLE);

  await page.goto("/automations?tab=builtin");
  const builtin = page.getByRole("list", { name: "Built-in rules" });
  await expect(builtin.getByText("Locked", { exact: true })).toHaveCount(5);
  await expect(builtin).toContainText("an unsubscribe is always honored");
  await expect(builtin.getByLabel("Enabled")).toBeChecked();

  // deleting a rule asks first; dismissing keeps it, accepting removes it
  await page.goto("/automations");
  const del = page.getByRole("button", { name: "Delete E2E reply task" });
  page.once("dialog", (d) => void d.dismiss());
  await del.click();
  await expect(page.getByRole("table", { name: "Rules" })).toContainText("E2E reply task");
  page.once("dialog", (d) => void d.accept());
  await del.click();
  await expect(page.getByRole("table", { name: "Rules" })).toHaveCount(0);
});
