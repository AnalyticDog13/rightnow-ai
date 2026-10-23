import { expect, test } from "@playwright/test";
import { deliverDue, dispatchEvents, systemClock } from "@rightnow/core";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// E2E: a webhook is created in the UI (secret shown once), tested, receives a real delivery (one dispatch pass and one
// delivery pass run directly, the target is the _fake/echo route), is redelivered, resumed from ERROR, and picked in a rule.
test.use({ storageState: STATE });
test.setTimeout(180_000); // cold route compiles under next dev
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);
const NAME = "E2E hook";

async function clean() {
  const prisma = db();
  await prisma.webhook.deleteMany({ where: { name: NAME } });
  await prisma.event.deleteMany({ where: { dedupeKey: { startsWith: "hook-e2e:" } } });
  await prisma.lead.deleteMany({ where: { email: { endsWith: "@e2e-hook.io" } } });
  await prisma.$disconnect();
}
test.beforeAll(clean);
test.afterAll(clean);

test("create, test, deliver, redeliver, resume and pick a webhook in a rule", async ({
  page,
  baseURL,
}) => {
  await page.goto("/automations?tab=webhooks");
  await page.getByRole("button", { name: "New webhook" }).click();
  await page.getByLabel("Name", { exact: true }).fill(NAME);
  await page.getByLabel("URL").fill(`${baseURL}/api/v1/_fake/echo`);
  await page.getByRole("button", { name: "Save webhook" }).click(); // no event yet
  await expect(page.locator("p[role=alert]")).toContainText("Choose at least one event"); // announced
  await page.getByLabel("email_sent", { exact: true }).check();
  await page.getByRole("button", { name: "Save webhook" }).click();

  const secret = page.getByRole("region", { name: "Signing secret" });
  await expect(secret.getByLabel("Signing secret value")).toHaveValue(/^whsec_[A-Za-z0-9_-]{43}$/);
  await secret.getByRole("button", { name: "I have saved it" }).click();
  await expect(secret).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("whsec_")).toHaveCount(0); // never shown again
  const table = page.getByRole("table", { name: "Webhooks" });
  await expect(table).toContainText(NAME);
  await expect(table).toContainText("Active");

  await page.getByRole("button", { name: `Test ${NAME}` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Test of" })).toContainText("HTTP 200");

  // a send event reaches the subscribed webhook: dispatch writes the delivery, the delivery pass POSTs it
  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  const lead = await prisma.lead.create({ data: { workspaceId: ws, email: "ann@e2e-hook.io" } });
  await prisma.event.create({
    data: {
      workspaceId: ws,
      type: "ACCEPTED",
      occurredAt: new Date(),
      leadId: lead.id,
      dedupeKey: "hook-e2e:sent",
    },
  });
  await dispatchEvents(prisma, systemClock, { maxMs: 1 });
  await deliverDue(prisma, systemClock, { allowPrivate: true, maxMs: 10_000 });

  await page.getByRole("button", { name: `Deliveries of ${NAME}` }).click();
  const log = page.getByRole("table", { name: "Deliveries", exact: true });
  const row = log.getByRole("row", { name: /email_sent/ });
  await expect(row).toContainText("DELIVERED");
  await expect(row).toContainText("200");
  await row.getByRole("button", { name: /View payload/ }).click();
  await expect(page.getByLabel("Payload JSON")).toContainText('"lead_email": "ann@e2e-hook.io"');

  await row.getByRole("button", { name: /Redeliver/ }).click();
  await expect(row).toContainText("PENDING");
  await deliverDue(prisma, systemClock, { allowPrivate: true, maxMs: 10_000 });
  await page.getByLabel("Status", { exact: true }).selectOption("DELIVERED");
  await expect(log.getByRole("row", { name: /email_sent/ })).toContainText("DELIVERED");

  // an auto-disabled webhook is resumed
  await prisma.webhook.updateMany({
    where: { name: NAME },
    data: {
      status: "ERROR",
      consecutiveFailures: 20,
      disabledAt: new Date(),
      lastError: "http_500",
    },
  });
  await prisma.$disconnect();
  await page.reload();
  await expect(table).toContainText("Error since");
  // the delivery chart has a text alternative
  await expect(page.getByRole("table", { name: "Deliveries by day" })).toContainText("1");
  await page.getByRole("button", { name: `Resume ${NAME}` }).click();
  await expect(table).toContainText("Active");
  await expect(table).not.toContainText("Error since");

  // the send_webhook action picks from the workspace's webhooks
  await page.goto("/automations");
  await page.getByRole("button", { name: "New rule" }).click();
  await page.getByLabel("Then 1").selectOption({ label: "Send webhook" });
  await expect(
    page.getByLabel("Webhook", { exact: true }).getByRole("option", { name: new RegExp(NAME) }),
  ).toHaveCount(1);

  // deleting asks first
  await page.goto("/automations?tab=webhooks");
  const del = page.getByRole("button", { name: `Delete ${NAME}` });
  page.once("dialog", (d) => void d.dismiss());
  await del.click();
  await expect(table).toContainText(NAME);
  page.once("dialog", (d) => void d.accept());
  await del.click();
  await expect(page.getByRole("table", { name: "Webhooks" })).toHaveCount(0);
});
