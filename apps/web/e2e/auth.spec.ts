import { expect, test } from "@playwright/test";
import { SETUP_TOKEN } from "./env";

const NAV = [
  "Dashboard",
  "Email Accounts",
  "Warm-Up & Deliverability",
  "Campaigns",
  "Leads",
  "Unified Inbox",
  "CRM",
  "Analytics",
  "Automations",
  "Settings",
];

async function fillSignUp(page: import("@playwright/test").Page, token: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Ada Owner");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password (12+ characters)").fill("correct horse battery");
  await page.getByLabel("Workspace name").fill("Acme");
  await page.getByLabel("Setup token").fill(token);
  await page.getByRole("button", { name: "Create owner account" }).click();
}

test("unauthenticated users are sent to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("wrong setup token is rejected", async ({ page }) => {
  await fillSignUp(page, "wrong-token-wrong-token");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Invalid setup token");
});

test("an 11-character password is rejected and creates no user", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Short Pw");
  await page.getByLabel("Email").fill("short@example.com");
  await page.getByLabel("Password (12+ characters)").fill("elevenchars");
  await page.getByLabel("Workspace name").fill("Short");
  await page.getByLabel("Setup token").fill(SETUP_TOKEN);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(page.getByRole("main").getByRole("alert")).not.toBeEmpty();
  await expect(page).toHaveURL(/\/sign-up/);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("short@example.com");
  await page.getByLabel("Password").fill("elevenchars");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).not.toBeEmpty();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("first owner signs up, sees the 10 nav items, signs out; second sign-up is blocked", async ({
  page,
}) => {
  await fillSignUp(page, SETUP_TOKEN);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(NAV);

  // signed-in users skip the auth pages
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/sign-up");
  await expect(page).toHaveURL(/\/dashboard/);

  // API keys: create shows the token once, revoke asks for confirmation
  await page.goto("/settings/api-keys");
  await page.getByLabel("Name").fill("ci");
  await page.getByLabel("leads:read").check();
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByTestId("new-token")).toHaveText(/^rn_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
  await page.getByRole("button", { name: "I have copied it" }).click();
  await expect(page.getByTestId("new-token")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "leads:read" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Revoke ci" }).click();
  await expect(page.getByRole("cell", { name: /^Revoked/ })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.goto("/sign-up");
  await expect(page.getByText("Sign-up is closed")).toBeVisible();
  const res = await page.request.post("/api/setup", {
    data: {
      name: "Eve",
      email: "eve@example.com",
      password: "correct horse battery",
      workspaceName: "Evil",
      token: SETUP_TOKEN,
    },
  });
  expect(res.status()).toBe(409);
});
