import { expect, test, type Page } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// D49 / R20: a strict nonce CSP on every page, the security headers, and pages that still hydrate. Runs after auth.spec.
test.use({ storageState: STATE });
test.setTimeout(180_000); // cold route compiles under next dev
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const EMAIL = "csp@e2e-csp.test";
const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);
test.afterAll(async () => {
  const prisma = db();
  await prisma.emailAccount.deleteMany({ where: { email: EMAIL } }); // cascades the thread, message, attachment
  await prisma.$disconnect();
});

/** Every CSP violation the page reports (console errors in Chromium, plus the DOM event). */
function violations(page: Page) {
  const seen: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) seen.push(m.text());
  });
  return seen;
}
const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];

test("the dashboard has a fresh nonce CSP with strict-dynamic; walking pages raises no CSP error", async ({
  page,
}) => {
  const seen = violations(page);
  const first = (await page.goto("/dashboard"))!;
  const csp = first.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("img-src 'self' data: blob: https:");
  expect(nonceOf(csp)).toBeTruthy();
  const h = first.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
  const again = (await page.goto("/dashboard"))!.headers()["content-security-policy"] ?? "";
  expect(nonceOf(again)).toBeTruthy();
  expect(nonceOf(again)).not.toBe(nonceOf(csp));

  // client-side navigation only works once the page hydrated, i.e. its scripts ran under the CSP
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Unified Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox/);
  await expect(page.getByRole("navigation", { name: "Inbox views" })).toBeVisible();
  await nav.getByRole("link", { name: "Campaigns" }).click();
  await expect(page).toHaveURL(/\/campaigns/);
  await nav.getByRole("link", { name: "Analytics" }).click(); // Recharts
  await expect(page).toHaveURL(/\/analytics/);
  await page.waitForLoadState("networkidle");
  expect(seen).toEqual([]);
});

test("API responses carry nosniff; an attachment download keeps its sandbox CSP", async ({
  page,
}) => {
  const health = await page.request.get("/api/healthz");
  expect(health.headers()["x-content-type-options"]).toBe("nosniff");
  expect(health.headers()["content-security-policy"]).toBeUndefined(); // the page CSP is not applied to the API

  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  await prisma.emailAccount.deleteMany({ where: { email: EMAIL } });
  const account = await prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      email: EMAIL,
      fromName: "C",
      firstName: "C",
      lastName: "S",
      capTier: "SMTP",
      providerCap: 100,
      credentialsEnc: "x",
    },
  });
  const now = new Date();
  const thread = await prisma.thread.create({
    data: { workspaceId: ws, accountId: account.id, subject: "CSP", lastMessageAt: now },
  });
  const msg = await prisma.message.create({
    data: {
      workspaceId: ws,
      accountId: account.id,
      threadId: thread.id,
      rfcMessageId: `<csp-${now.getTime()}@e2e-csp.test>`,
      direction: "IN",
      folder: "INBOX",
      fromEmail: "x@e2e-csp.test",
      subject: "CSP",
      sentAt: now,
      kind: "REPLY",
    },
  });
  const att = await prisma.attachment.create({
    data: {
      messageId: msg.id,
      filename: "page.html",
      contentType: "text/html",
      size: 20,
      data: Buffer.from("<script>1</script>"),
    },
  });
  await prisma.$disconnect();
  const r = await page.request.get(`/api/v1/inbox/attachments/${att.id}`);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
  expect(r.headers()["content-disposition"]).toMatch(/^attachment;/);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sign-in, an invite link and a 404 page raise no CSP error", async ({ page }) => {
    const seen = violations(page);
    const signIn = (await page.goto("/sign-in"))!;
    expect(nonceOf(signIn.headers()["content-security-policy"] ?? "")).toBeTruthy();
    await expect(page.getByLabel("Email")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.goto("/invite/e2e-not-an-invite");
    await page.waitForLoadState("networkidle");
    const missing = (await page.goto("/e2e-no-such-page"))!;
    expect(missing.status()).toBe(404);
    expect(nonceOf(missing.headers()["content-security-policy"] ?? "")).toBeTruthy();
    await page.waitForLoadState("networkidle");
    expect(seen).toEqual([]);
  });

  test("the theme script runs before hydration (it carries the nonce)", async ({ page }) => {
    const seen = violations(page);
    // no framework chunks: React never hydrates, so only the inline (nonce) theme script can set the class
    await page.route("**/_next/static/chunks/**", (r) => r.abort());
    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveClass(/\b(light|dark)\b/);
    expect(seen).toEqual([]);
  });
});
