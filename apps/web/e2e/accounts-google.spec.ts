import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Runs after auth.spec (project dependency), which created the owner. MAIL_PROVIDER_FAKE=1, see global-setup.
// Sign in once: the sign-in endpoint allows 5 attempts a minute, fewer than this file has tests.
const STATE = join(tmpdir(), "rightnow-e2e-ada.json");
test.use({ storageState: STATE });
test.beforeAll(async ({ browser }, info) => {
  const ctx = await browser.newContext({
    baseURL: info.project.use.baseURL,
    storageState: undefined,
  });
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await ctx.storageState({ path: STATE });
  await ctx.close();
});
test.beforeEach(async ({ page }) => {
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

test("Cancel stops waiting and invalidates the server session; a closed popup alone does not", async ({
  page,
}) => {
  let starts = 0;
  const polls: Record<string, number> = { s1: 0, s2: 0 };
  await page.route("**/api/v1/oauth/google/start", (r) =>
    r.fulfill({
      json: { sessionId: `s${++starts}`, authUrl: "about:blank", expiresAt: "2099-01-01" },
    }),
  );
  for (const id of ["s1", "s2"])
    await page.route(`**/api/v1/oauth/sessions/${id}`, (r) => {
      if (r.request().method() === "GET") polls[id]!++;
      return r.fulfill({ json: { status: "pending" } });
    });
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect Google" }).click();
  const popup = await opened;
  await popup.close();
  await page.waitForTimeout(2500); // still waiting after the popup closed
  await expect(page.getByRole("button", { name: "Waiting for Google..." })).toBeDisabled();
  const deleted = page.waitForRequest(
    (q) => q.method() === "DELETE" && q.url().endsWith("/api/v1/oauth/sessions/s1"),
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await deleted;
  await expect(page.getByRole("button", { name: "Connect Google" })).toBeEnabled();

  // Connect again: the cancelled attempt's loop must not keep polling.
  await page.waitForTimeout(300); // a request already in flight may still land
  const settled = polls.s1!;
  await page.getByRole("button", { name: "Connect Google" }).click();
  await expect.poll(() => polls.s2).toBeGreaterThan(1);
  expect(polls.s1).toBe(settled);
});

test("Connect Microsoft lists a Microsoft account and Reconnect appears in its drawer", async ({
  page,
}) => {
  // The UI has no email field; steer the fake provider to its own mailbox through the start body.
  await page.route("**/api/v1/oauth/microsoft/start", (r) =>
    r.continue({ postData: JSON.stringify({ loginHint: "ms@example.test" }) }),
  );
  await page.getByRole("button", { name: "Connect Microsoft" }).click();
  await expect(row(page, "ms@example.test")).toContainText("Microsoft");

  await page.getByRole("button", { name: "Reconnect ms@example.test" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("button", { name: "Reconnect Microsoft" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Reconnect Google" })).toHaveCount(0);
});
