import { expect, test } from "@playwright/test";
import { ensureSession, STATE } from "./session";

// Runs after auth.spec. Shares the owner session from session.ts. MAIL_PROVIDER_FAKE=1 (global-setup): the send happens in the web server, the
// assertion reads the mailbox file back through /_fake/mailbox, the same path a worker process would use.
const EMAIL = "testsend@example.test";
test.use({ storageState: STATE });
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

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
  // the full-page OAuth fallback must finish its round trip (callback, redirect back to /accounts) before the drawer is opened
  const back = page.waitForResponse((r) => r.url().includes("/api/v1/oauth/google/callback"));
  await page.getByRole("button", { name: "Connect Google" }).click();
  await back;
  await page.waitForURL((u) => u.pathname === "/accounts");
  await page.waitForLoadState("load");
  const drawer = page.getByRole("dialog");
  const send = drawer.getByRole("button", { name: "Send test email" });
  // belt and braces: if a late refresh still detaches the drawer, reopen it and redo the whole sequence up to the click
  await expect(async () => {
    await page.getByRole("button", { name: `Limits for ${EMAIL}` }).click({ timeout: 5000 });
    await drawer.getByLabel("Send test email to").fill("target@dest.example", { timeout: 5000 });
    await expect(send).toBeDisabled({ timeout: 2000 });
    await drawer.getByLabel("I am authorized to send from this account").check({ timeout: 5000 });
    await expect(send).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await send.click();
  await expect(drawer.getByText("Test email sent.")).toBeVisible();

  const res = await page.request.get(`/api/v1/_fake/mailbox/${EMAIL}`);
  expect(res.status()).toBe(200);
  const box = (await res.json()) as { sent: { headers: Record<string, string[]> }[] };
  expect(box.sent).toHaveLength(1);
  expect(box.sent[0]!.headers["x-rightnow-test"]).toEqual(["1"]);
});
