import { expect, test, type Page } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// Runs after auth.spec (project dependency). Accounts are seeded straight into the e2e database.
const ANN = "ann@acme-e2e.io";
const BOB = "bob@acme-e2e.io";
const CAROL = "carol@outlook.com";
const rows = [
  { email: ANN, provider: "GMAIL", capTier: "GMAIL_WORKSPACE", providerCap: 1500, tags: ["sales"] },
  { email: BOB, provider: "MICROSOFT", capTier: "MS365", providerCap: 5000, tags: [] },
  { email: CAROL, provider: "MICROSOFT", capTier: "OUTLOOK_COM", providerCap: 250, tags: [] },
] as const;

test.beforeAll(async () => {
  const prisma = createPrisma(process.env.E2E_DATABASE_URL!, 2);
  const ws = await prisma.workspace.findFirstOrThrow();
  if (await prisma.emailAccount.count({ where: { email: ANN } })) return prisma.$disconnect(); // worker restart after a failure
  const day = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  for (const r of rows) {
    const a = await prisma.emailAccount.create({
      data: {
        workspaceId: ws.id,
        fromName: r.email.split("@")[0]!,
        firstName: "F",
        lastName: "L",
        ...r,
        tags: [...r.tags],
      },
    });
    if (r.email === ANN)
      await prisma.accountDailyUsage.create({ data: { accountId: a.id, day, sent: 4 } });
  }
  await prisma.$disconnect();
});

// Sign-in is rate limited, see session.ts.
test.use({ storageState: STATE });
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

test.beforeEach(async ({ page }) => {
  await page.goto("/accounts");
});

const row = (page: Page, email: string) => page.getByRole("row").filter({ hasText: email });

test("table shows real status, usage and tags; search filters", async ({ page }) => {
  await expect(page.getByRole("table", { name: "Email accounts" })).toBeVisible();
  await expect(row(page, ANN)).toContainText("Google");
  await expect(row(page, ANN)).toContainText("Active");
  await expect(row(page, ANN)).toContainText("4 / 30 / 26");
  await expect(row(page, ANN)).toContainText("sales");
  await expect(row(page, BOB)).toContainText("0 / 30 / 30");
  await page.getByLabel("Search accounts").fill("sales");
  await expect(row(page, ANN)).toHaveCount(1);
  await expect(row(page, BOB)).toHaveCount(0);
});

test("select with Space, bulk pause", async ({ page }) => {
  for (const email of [ANN, BOB]) {
    await page.getByLabel(`Select ${email}`).focus();
    await page.keyboard.press("Space");
    await expect(page.getByLabel(`Select ${email}`)).toBeChecked();
  }
  await page
    .getByRole("toolbar", { name: "Bulk actions" })
    .getByRole("button", { name: "Pause", exact: true })
    .click();
  await expect(row(page, ANN)).toContainText("Paused");
  await expect(row(page, BOB)).toContainText("Paused");
  await expect(row(page, CAROL)).toContainText("Active");
});

test("drawer: signature saves, a limit above the provider cap is clamped with a warning, Escape closes", async ({
  page,
}) => {
  await page.getByRole("button", { name: `Limits for ${CAROL}` }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Signature").fill("Best,\nCarol");
  await drawer.getByLabel("Daily limit").fill("999");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByRole("status")).toContainText("Daily limit was set to 125");
  await expect(drawer.getByLabel("Daily limit")).toHaveValue("125");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(row(page, CAROL)).toContainText("0 / 125 / 125");
  await page.reload();
  await page.getByRole("button", { name: `Limits for ${CAROL}` }).click();
  await expect(page.getByRole("dialog").getByLabel("Signature")).toHaveValue("Best,\nCarol");
});
