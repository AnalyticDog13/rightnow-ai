import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// E2E: the Analytics page over seeded events: tiles equal the API, URL filters, variant pause, CSV, metric menu.
// Runs after auth.spec.
test.use({ storageState: STATE });
test.setTimeout(180_000); // cold route compiles under next dev
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);
const DAY = 86_400_000;
let campaignId = "";

async function clean() {
  const prisma = db();
  await prisma.event.deleteMany({ where: { dedupeKey: { startsWith: "an-e2e:" } } });
  await prisma.campaign.deleteMany({ where: { name: "E2E Analytics" } });
  await prisma.lead.deleteMany({ where: { email: { endsWith: "@e2e-an.io" } } });
  await prisma.$disconnect();
}
test.beforeAll(async () => {
  await clean();
  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  const campaign = await prisma.campaign.create({
    data: { workspaceId: ws, name: "E2E Analytics", status: "ACTIVE" },
  });
  campaignId = campaign.id;
  const step = await prisma.sequenceStep.create({
    data: { campaignId, order: 1, delayValue: 0 },
  });
  const a = await prisma.stepVariant.create({
    data: { stepId: step.id, label: "A", subject: "Hi", body: "Hello" },
  });
  const b = await prisma.stepVariant.create({
    data: { stepId: step.id, label: "B", subject: "Hi", body: "Hello" },
  });
  const lead = (n: string) =>
    prisma.lead.create({ data: { workspaceId: ws, email: `${n}@e2e-an.io` } });
  const [l1, l2, l3] = [await lead("one"), await lead("two"), await lead("three")];
  const ev = (
    key: string,
    type: "ACCEPTED" | "REPLY" | "OPEN",
    leadId: string,
    variantId: string,
    ago: number,
  ) => ({
    workspaceId: ws,
    type,
    occurredAt: new Date(Date.now() - ago * DAY),
    leadId,
    campaignId,
    stepId: step.id,
    variantId,
    dedupeKey: `an-e2e:${key}`,
  });
  // 30 days: Sent 3, Replied 1, Opened 1 (contacted 3); the last 7 days: Sent 2
  await prisma.event.createMany({
    data: [
      ev("s1", "ACCEPTED", l1.id, a.id, 1),
      ev("s2", "ACCEPTED", l2.id, b.id, 1),
      ev("s3", "ACCEPTED", l3.id, a.id, 20),
      ev("r1", "REPLY", l1.id, a.id, 0.9),
      ev("o1", "OPEN", l1.id, a.id, 0.95),
    ],
  });
  await prisma.$disconnect();
});
test.afterAll(clean);

const tile = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const value = (page: Page, name: string) => tile(page, name).locator("p").nth(1);

test("tiles equal the API total; Estimated open rate shows its denominator", async ({ page }) => {
  const api = page.waitForResponse(
    (r) => r.url().includes("/api/v1/analytics?") && r.url().includes("groups="),
  );
  await page.goto("/analytics");
  const total = (await (await api).json()).campaign.total as { sent: number; replied: number };
  await expect(value(page, "Sent")).toHaveText(String(total.sent));
  await expect(value(page, "Replied")).toHaveText(String(total.replied));
  await expect(tile(page, "Sent")).toHaveAttribute("title", /not proof of delivery/);
  await expect(tile(page, "Opened")).toContainText("Estimated");
  await expect(tile(page, "Opened")).toHaveAttribute("title", /\d+ of \d+ contacted/);
  // totals and per-row Contacted can differ: the explanation is on the page
  await expect(page.getByText(/appears in both rows/).first()).toBeVisible();
});

test("campaign filter + 7-day preset update the URL and the numbers", async ({ page }) => {
  await page.goto("/analytics");
  await page.getByLabel("Campaigns").selectOption({ label: "E2E Analytics" });
  await expect(page).toHaveURL(new RegExp(`campaignIds=${campaignId}`));
  await expect(value(page, "Sent")).toHaveText("3");
  await expect(value(page, "Replied")).toHaveText("1");
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d\d-\d\d/);
  await expect(value(page, "Sent")).toHaveText("2");
});

test("variant table pauses B, and the builder shows it inactive", async ({ page }) => {
  await page.goto(`/analytics?campaignIds=${campaignId}`);
  await expect(
    page.getByText("Use at least 3 months of data before pausing a variant."),
  ).toBeVisible();
  const box = page.getByRole("checkbox", { name: "Step 1 B active" });
  await expect(box).toBeChecked();
  const patched = page.waitForResponse(
    (r) => r.url().includes("/variants/") && r.request().method() === "PATCH",
  );
  await box.click(); // the box follows the server state, so click, not uncheck
  expect((await patched).status()).toBe(200);
  await expect(box).not.toBeChecked();

  await page.goto(`/campaigns/${campaignId}`);
  await page.getByRole("tab", { name: "Sequences" }).click();
  await expect(
    page.getByRole("group", { name: "Variant B" }).getByLabel("Active"),
  ).not.toBeChecked();
});

test("Download CSV on the campaigns table starts with the header", async ({ page }) => {
  await page.goto("/analytics");
  const link = page
    .getByRole("region", { name: "Campaigns" })
    .getByRole("link", { name: "Download CSV" });
  await expect(link).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const text = readFileSync((await file.path())!, "utf8");
  expect(text.split("\r\n")[0]).toMatch(/^key,label,sent,contacted,/);
});

test("hiding Clicked in the Metrics menu removes it and survives a reload", async ({ page }) => {
  await page.goto("/analytics");
  await expect(tile(page, "Clicked")).toBeVisible();
  await page.getByRole("button", { name: "Metrics" }).click();
  await page.getByRole("checkbox", { name: "Clicked" }).uncheck();
  await expect(tile(page, "Clicked")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("checkbox", { name: "Clicked" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Metrics" })).toBeFocused();
  await page.reload();
  await expect(tile(page, "Sent")).toBeVisible();
  await expect(tile(page, "Clicked")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Clicked" })).toHaveCount(0);
});

test("an unknown time zone in the URL shows the API error instead of crashing", async ({
  page,
}) => {
  await page.goto("/analytics?tz=Bogus/Zone");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
});
