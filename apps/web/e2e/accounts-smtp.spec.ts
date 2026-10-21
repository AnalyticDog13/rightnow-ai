import { expect, test, type Page } from "@playwright/test";
import { ensureSession, STATE } from "./session";

// Runs after auth.spec (project dependency). MAIL_PROVIDER_FAKE=1, see global-setup: hosts named fail.* fail the checks.
test.use({ storageState: STATE });
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));
test.beforeEach(async ({ page }) => {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Connect with SMTP/IMAP" }).click();
});

const PASSWORD = "s3cret-pass-Z9";
async function fill(page: Page, o: { email: string; host: string }) {
  await page.getByLabel("Email", { exact: true }).fill(o.email);
  await page.getByLabel("First name").fill("Sam");
  await page.getByLabel("IMAP host").fill(o.host);
  await page.getByLabel("IMAP password").fill(PASSWORD);
  await page.getByLabel("SMTP host").fill(o.host);
  await page.getByLabel("SMTP password").fill(PASSWORD);
}

test("empty fields show validation messages and nothing is sent", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/v1/accounts/test-connection", (r) => (posts++, r.continue()));
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Email is required")).toBeVisible();
  await expect(page.getByText("First name is required")).toBeVisible();
  await expect(page.getByText("Host is required")).toHaveCount(2);
  await expect(page.getByText("Password is required")).toHaveCount(2);
  await page.getByLabel("IMAP port").fill("70000");
  await page.getByLabel("Email", { exact: true }).fill("not-an-email");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Port must be 1 to 65535")).toBeVisible();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  expect(posts).toBe(0);
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("a failing host shows the failed check names and keeps Save disabled", async ({ page }) => {
  await fill(page, { email: "bad@smtp-e2e.test", host: "fail.smtp-e2e.test" });
  await page.getByRole("button", { name: "Test connection" }).click();
  const checks = page.getByRole("list", { name: "Connection checks" });
  await expect(checks).toContainText("IMAP login");
  await expect(checks).toContainText("failed");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("Save is enabled only after Test connection passes; an edit disables it again; the saved row appears and the page never contains the password", async ({
  page,
}) => {
  await fill(page, { email: "sam@smtp-e2e.test", host: "mail.smtp-e2e.test" });
  const save = page.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(save).toBeEnabled();
  await page.getByLabel("SMTP host").fill("mail2.smtp-e2e.test");
  await expect(save).toBeDisabled(); // what was tested is no longer what would be saved
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(save).toBeEnabled();
  await save.click();

  const row = page.getByRole("row").filter({ hasText: "sam@smtp-e2e.test" });
  await expect(row).toContainText("SMTP");
  expect(await page.content()).not.toContain(PASSWORD);
  await page.reload();
  expect(await page.content()).not.toContain(PASSWORD);
  await expect(page.getByRole("row").filter({ hasText: "sam@smtp-e2e.test" })).toHaveCount(1);
});

test("Reconnect updates the credentials of the same SMTP account", async ({ page }) => {
  await fill(page, { email: "re@smtp-e2e.test", host: "mail.smtp-e2e.test" });
  await page.getByRole("button", { name: "Test connection" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  const row = page.getByRole("row").filter({ hasText: "re@smtp-e2e.test" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Reconnect re@smtp-e2e.test" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Reconnect with new credentials" }).click();
  await expect(drawer.getByLabel("Email", { exact: true })).toBeHidden(); // the mailbox is fixed
  const submit = async (host: string) => {
    await drawer.getByLabel("IMAP host").fill(host);
    await drawer.getByLabel("IMAP password").fill(PASSWORD);
    await drawer.getByLabel("SMTP host").fill(host);
    await drawer.getByLabel("SMTP password").fill(PASSWORD);
    await drawer.getByRole("button", { name: "Test and save" }).click();
  };
  await submit("fail.smtp-e2e.test");
  await expect(drawer.getByRole("list", { name: "Connection checks" })).toContainText("failed");
  const saved = page.waitForResponse(
    (r) => /\/api\/v1\/accounts\/[^/]+\/credentials$/.test(r.url()) && r.ok(),
  );
  await submit("mail3.smtp-e2e.test");
  expect((await saved).status()).toBe(200);
  await expect(
    drawer.getByRole("button", { name: "Reconnect with new credentials" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "re@smtp-e2e.test" })).toHaveCount(1);
  expect(await page.content()).not.toContain(PASSWORD);
});
