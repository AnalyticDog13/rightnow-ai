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

test("first owner signs up, sees the 10 nav items, signs out; second sign-up is blocked", async ({
  page,
}) => {
  await fillSignUp(page, SETUP_TOKEN);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(NAV);

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
