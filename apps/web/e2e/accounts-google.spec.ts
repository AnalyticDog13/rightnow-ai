import { expect, test } from "@playwright/test";

// Runs after auth.spec (project dependency), which created the owner. MAIL_PROVIDER_FAKE=1, see global-setup.
test.beforeEach(async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/accounts");
});

const row = (page: import("@playwright/test").Page, email: string) =>
  page.getByRole("row").filter({ hasText: email });

test("Connect Google opens a popup that closes and lists the account; connecting again says it exists", async ({
  page,
}) => {
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect Google" }).click();
  const popup = await opened;
  await expect.poll(() => popup.isClosed()).toBe(true); // may already be closed: no event wait

  await expect(row(page, "fake@example.test")).toContainText("Google");

  await page.getByRole("button", { name: "Connect Google" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("already connected");
  await expect(row(page, "fake@example.test")).toHaveCount(1);
});

test("with the popup blocked, the full-page fallback also connects", async ({ page }) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });
  // The UI has no email field; steer the fake provider to a second mailbox through the start body.
  await page.route("**/api/v1/oauth/google/start", (r) =>
    r.continue({ postData: JSON.stringify({ loginHint: "fallback@example.test" }) }),
  );
  await page.getByRole("button", { name: "Connect Google" }).click();
  await expect(row(page, "fallback@example.test")).toContainText("Google");
});
