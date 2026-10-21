import { expect, test } from "@playwright/test";
import { hashValue, runImport, systemClock } from "@rightnow/core";
import { createPrisma } from "@rightnow/db/create";

// E2E #3. Runs after auth.spec (project dependency). No worker runs in e2e, so the spec plays its part:
// it runs the PENDING import job itself while the wizard polls.
const CSV =
  "﻿Email;First Name;Company\r\n" +
  "ann@e2e-import.io;Ann;Acme\r\n" +
  "bob@e2e-import.io;Bob;Acme\r\n" +
  "not-an-email;Bad;X\r\n" +
  "ann@e2e-import.io;Dup;Acme\r\n" +
  "carl@e2e-import.io;Carl;Beta\r\n" +
  "dee@e2e-import.io;Dee;Beta\r\n";

let cookies: Awaited<
  ReturnType<import("@playwright/test").APIRequestContext["storageState"]>
>["cookies"] = [];
test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  for (let i = 0; i < 8; i++) {
    const r = await api.post("/api/auth/sign-in/email", {
      data: { email: "ada@example.com", password: "correct horse battery" },
      headers: { origin: baseURL! },
    });
    if (r.ok()) break;
    await new Promise((r) => setTimeout(r, 10_000)); // sign-in is rate limited
  }
  cookies = (await api.storageState()).cookies;
  expect(cookies.length).toBeGreaterThan(0);
  await api.dispose();
});

async function runPendingImport() {
  const prisma = createPrisma(process.env.E2E_DATABASE_URL!, 2);
  try {
    let id: string | undefined;
    for (let i = 0; i < 60 && !id; i++) {
      id = (await prisma.importJob.findFirst({ where: { status: "PENDING" } }))?.id;
      if (!id) await new Promise((r) => setTimeout(r, 500));
    }
    expect(id).toBeTruthy();
    await runImport(prisma, systemClock, { resolveMx: async () => [] }, id!);
  } finally {
    await prisma.$disconnect();
  }
}

test("import wizard: map, authorize, run, result counts, table, keyboard", async ({ page }) => {
  await page.context().addCookies(cookies);
  await page.goto("/leads");
  await page.getByRole("button", { name: "Import CSV" }).click();
  const wizard = page.getByRole("dialog", { name: "Import leads" });

  await expect(wizard.getByRole("heading", { name: /Step 1 of 4/ })).toBeVisible();
  await wizard
    .getByLabel(/CSV file/)
    .setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await expect(wizard.getByRole("status")).toContainText("6 rows found");
  await wizard.getByRole("button", { name: "Next" }).click();

  await expect(wizard.getByRole("heading", { name: /Step 2 of 4/ })).toBeVisible();
  await expect(wizard.getByLabel("Email", { exact: true })).toHaveValue("email");
  await wizard.getByRole("button", { name: "Next" }).click();

  await expect(wizard.getByRole("heading", { name: /Step 3 of 4/ })).toBeVisible();
  await expect(wizard.getByText("Invalid email: 1")).toBeVisible();
  const run = wizard.getByRole("button", { name: "Run import" });
  await expect(run).toBeDisabled();
  await wizard.getByLabel("I am authorized to email these contacts").check();
  await expect(run).toBeEnabled();
  await run.click();

  await expect(wizard.getByRole("heading", { name: /Step 4 of 4/ })).toBeVisible();
  await runPendingImport();
  const result = wizard.getByRole("status", { name: "Import result" });
  await expect(result.getByText("Imported 4", { exact: true })).toBeVisible();
  await expect(result.getByText("Invalid email 1", { exact: true })).toBeVisible();
  await expect(result.getByText("Duplicate in file 1", { exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: "Done" }).click();

  const table = page.getByRole("table", { name: "Leads" });
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await expect(page.getByRole("status").filter({ hasText: "Showing 4 of 4" })).toBeVisible();

  // keyboard: rows are focusable and Enter opens the lead drawer
  const row = table.getByRole("row").filter({ hasText: "ann@e2e-import.io" });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "ann@e2e-import.io" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel("First name")).toHaveValue("Ann");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("bounced view removes a suppression; blocklist page shows honest counts", async ({ page }) => {
  const prisma = createPrisma(process.env.E2E_DATABASE_URL!, 2);
  const ws = await prisma.workspace.findFirstOrThrow();
  await prisma.suppression.create({
    data: {
      workspaceId: ws.id,
      kind: "EMAIL",
      value: "bob@e2e-import.io",
      valueHash: hashValue("bob@e2e-import.io"),
      reason: "HARD_BOUNCE",
      source: "bounce",
    },
  });
  await prisma.$disconnect();
  await page.context().addCookies(cookies);

  await page.goto("/leads");
  await page.getByRole("button", { name: "Bounced", exact: true }).click();
  const bounced = page.getByRole("table", { name: "Bounced leads" });
  await expect(bounced.getByRole("row").filter({ hasText: "bob@e2e-import.io" })).toContainText(
    "Hard bounce",
  );
  await expect(page.getByText("Showing 1 of 1 bounced addresses")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove bob@e2e-import.io from the blocklist" }).click();
  await expect(bounced.getByText("No bounced addresses.")).toBeVisible();

  await page.goto("/blocklist");
  await page.getByLabel(/Add emails or domains/).fill("Bad@X.test spam.test nope");
  await page.getByRole("button", { name: "Add to blocklist" }).click();
  await expect(page.getByText("Added 2. Already listed 0. Invalid 1.")).toBeVisible();
  await expect(page.getByText("Showing 2 of 2 entries")).toBeVisible();
  await expect(page.getByRole("cell", { name: "bad@x.test", exact: true })).toBeVisible();
});
