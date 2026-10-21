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
