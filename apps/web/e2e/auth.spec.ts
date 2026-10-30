import { expect, test } from "@playwright/test";
import { SETUP_TOKEN } from "./env";
import { totp } from "./totp";

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

let inviteLink = "";

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Onboarding wizard (B5.18): welcome -> token -> login -> workspace. */
async function startWizard(page: import("@playwright/test").Page, token: string) {
  await page.goto("/sign-up");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("Setup token").fill(token);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function fillSignUp(page: import("@playwright/test").Page, token: string) {
  await startWizard(page, token);
  await page.getByLabel("Your name").fill("Ada Owner");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password (12+ characters)").fill("correct horse battery");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Workspace name").fill("Acme");
  await page.getByRole("button", { name: "Create owner account" }).click();
}

test("unauthenticated users are sent to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("wrong setup token is rejected at the token step", async ({ page }) => {
  await startWizard(page, "wrong-token-wrong-token");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "doesn't match SETUP_TOKEN",
  );
  await expect(page.getByRole("heading", { name: "Verify this is your server" })).toBeVisible();
});

test("an 11-character password is rejected and creates no user", async ({ page }) => {
  await startWizard(page, SETUP_TOKEN);
  await page.getByLabel("Your name").fill("Short Pw");
  await page.getByLabel("Email").fill("short@example.com");
  await page.getByLabel("Password (12+ characters)").fill("elevenchars");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await expect(page.getByLabel("Password (12+ characters)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page).toHaveURL(/\/sign-up$/);
  // the server refuses it too (the client check is only a convenience)
  const res = await page.request.post("/api/setup", {
    data: {
      name: "Short Pw",
      email: "short@example.com",
      password: "elevenchars",
      workspaceName: "Short",
      token: SETUP_TOKEN,
    },
  });
  expect(res.status()).toBe(400);
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

  // members: an invite link (no email is sent) for the next test
  await page.goto("/settings");
  await page.getByLabel("Invite by email").fill("grace@example.com");
  await page.getByRole("button", { name: "Create invite link" }).click();
  inviteLink = (await page.getByTestId("invite-link").textContent())!;
  expect(inviteLink).toMatch(/\/invite\/\w+$/);

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

test("an invited member joins, turns on 2FA, signs in with an app code, and a backup code works once", async ({
  page,
}) => {
  // sign-in is limited to 5 a minute per IP: start just after a window edge so this test's 4 sign-ins fit
  const into = Date.now() % 60_000;
  if (into > 5_000) await page.waitForTimeout(60_000 - into + 500);

  // the invite link signs the new member in
  await page.goto(inviteLink);
  await page.getByLabel("Your name").fill("Grace Member");
  await page.getByLabel("Password (12+ characters)").fill("another long password");
  await page.getByRole("button", { name: "Join workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto(inviteLink); // single use
  await expect(page.getByText("This invite link is not valid")).toBeVisible();

  // Settings > Security: enable with the shown key
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Members" })).toHaveCount(0); // a MEMBER does not manage members
  await page.getByLabel("Your password").fill("another long password");
  await page.getByRole("button", { name: "Set up two-factor" }).click();
  const key = (await page.getByTestId("totp-key").textContent())!;
  const backup = await page.getByTestId("backup-codes").getByRole("listitem").allTextContents();
  expect(backup).toHaveLength(10);
  await page.getByLabel("Code from the app").fill(totp(key));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.getByRole("button", { name: "Turn off two-factor" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  // sign in -> the 2FA page -> the code -> the dashboard
  await signIn(page, "grace@example.com", "another long password");
  await expect(page).toHaveURL(/\/sign-in\/2fa/);
  await page.getByLabel("Authentication code").fill(totp(key));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // the audit log page lists the enabling
  await page.goto("/settings");
  await expect(page.getByRole("cell", { name: "auth.2fa_enable", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  // a backup code works once
  await signIn(page, "grace@example.com", "another long password");
  await page.getByRole("button", { name: "Use a backup code" }).click();
  await page.getByLabel("Backup code").fill(backup[0]!);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "grace@example.com", "another long password");
  await page.getByRole("button", { name: "Use a backup code" }).click();
  await page.getByLabel("Backup code").fill(backup[0]!);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("main").getByRole("alert")).not.toBeEmpty();
  await expect(page).toHaveURL(/\/sign-in\/2fa/);
});
