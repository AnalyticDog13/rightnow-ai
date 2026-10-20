import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Runs after auth.spec. Reuses the session saved by accounts-google.spec (sign-in allows 5 attempts a minute). MAIL_PROVIDER_FAKE=1 (global-setup): the send happens in the web server, the
// assertion reads the mailbox file back through /_fake/mailbox, the same path a worker process would use.
const STATE = join(tmpdir(), "rightnow-e2e-ada.json");
const EMAIL = "testsend@example.test";
test.use({ storageState: STATE });
test.beforeAll(async ({ browser }, info) => {
  if (existsSync(STATE)) return;
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

test("send is disabled until authorized; success toast; the mailbox holds a marked message", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = () => null; // full-page OAuth fallback
  });
  await page.route("**/api/v1/oauth/google/start", (r) =>
    r.continue({ postData: JSON.stringify({ loginHint: EMAIL }) }),
  );
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Connect Google" }).click();
  await page.getByRole("button", { name: `Limits for ${EMAIL}` }).click();

  const drawer = page.getByRole("dialog");
  const send = drawer.getByRole("button", { name: "Send test email" });
  await drawer.getByLabel("Send test email to").fill("target@dest.example");
  await expect(send).toBeDisabled();
  await drawer.getByLabel("I am authorized to send from this account").check();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(drawer.getByText("Test email sent.")).toBeVisible();

  const res = await page.request.get(`/api/v1/_fake/mailbox/${EMAIL}`);
  expect(res.status()).toBe(200);
  const box = (await res.json()) as { sent: { headers: Record<string, string[]> }[] };
  expect(box.sent).toHaveLength(1);
  expect(box.sent[0]!.headers["x-rightnow-test"]).toEqual(["1"]);
});
