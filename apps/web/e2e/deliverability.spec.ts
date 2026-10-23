import { expect, test, type Page } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// Runs after auth.spec (project dependency). MAIL_PROVIDER_FAKE=1: re-warm skips the DNS check, like campaign launch.
const ACTIVE = "active@dl-e2e.io";
const IDLE = "idle@dl-e2e.io";
const DAY = 86_400_000;

test.beforeAll(async () => {
  const prisma = createPrisma(process.env.E2E_DATABASE_URL!, 2);
  const ws = await prisma.workspace.findFirstOrThrow();
  if (!(await prisma.emailAccount.count({ where: { email: IDLE } }))) {
    // the server's key, to seed credentials; the env schema also wants these two
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.DATABASE_URL ??= process.env.E2E_DATABASE_URL;
    process.env.APP_URL ??= "http://localhost:3100";
    const { encryptCredentials } = await import("@rightnow/core");
    const credentialsEnc = encryptCredentials({
      kind: "oauth",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 3600_000,
      scope: "s",
    });
    for (const [email, lifecycle, sent] of [
      [ACTIVE, "ACTIVE", 1],
      [IDLE, "INACTIVE", 45],
    ] as const)
      await prisma.emailAccount.create({
        data: {
          workspaceId: ws.id,
          email,
          provider: "GMAIL",
          capTier: "GMAIL_WORKSPACE",
          providerCap: 1500,
          fromName: "F",
          firstName: "F",
          lastName: "L",
          lifecycle,
          lastSentAt: new Date(Date.now() - sent * DAY),
          createdAt: new Date(Date.now() - 90 * DAY),
          credentialsEnc,
        },
      });
  }
  await prisma.$disconnect();
});

test.use({ storageState: STATE });
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const row = (page: Page, email: string) => page.getByRole("row").filter({ hasText: email });

test("dashboard: statuses, disclaimer, and Re-warm from an inactive row", async ({ page }) => {
  await page.goto("/deliverability");
  await expect(
    page.getByText(
      "Warm-up and re-warm-up cannot guarantee inbox placement. Health is an internal indicator, not a reputation guarantee.",
    ),
  ).toBeVisible();
  await expect(row(page, ACTIVE)).toContainText("Active");
  await expect(row(page, IDLE)).toContainText("Inactive");
  await expect(row(page, IDLE)).toContainText("Idle for 45 days");

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: `Re-warm ${IDLE}` }).click();
  await expect(row(page, IDLE)).toContainText("Re-Warming");
  await expect(
    page.getByRole("progressbar", { name: `Re-warm progress for ${IDLE}` }),
  ).toBeVisible();
  await expect(row(page, IDLE)).toContainText(
    "configurable plan, not a guaranteed reputation recovery timeline",
  );
});

test("deliverability settings persist after a reload", async ({ page }) => {
  await page.goto("/deliverability");
  await page.getByLabel("Inactive after (days without a campaign send)").selectOption("14");
  await page.getByLabel("Pause at a hard bounce rate above (%)").fill("5");
  await page.getByLabel("Share of the allowance kept when health slows an account (%)").fill("40");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Inactive after (days without a campaign send)")).toHaveValue("14");
  await expect(page.getByLabel("Pause at a hard bounce rate above (%)")).toHaveValue("5");
  await expect(
    page.getByLabel("Share of the allowance kept when health slows an account (%)"),
  ).toHaveValue("40");
});

test("verifier settings: write-only key, new host needs a key, last error shown", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Verifier", { exact: true }).selectOption("http");
  await page.getByLabel("Service URL (https)").fill("https://verify.example.test/v1");
  await page.getByLabel("API key").fill("super-secret-key");
  await page
    .getByLabel("Response field with the result (e.g. result.status)")
    .fill("result.status");
  await page.getByRole("button", { name: "Save verifier" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Verifier", { exact: true })).toHaveValue("http");
  await expect(page.getByLabel("Service URL (https)")).toHaveValue(
    "https://verify.example.test/v1",
  );
  await expect(page.getByLabel("API key")).toHaveValue("");
  await expect(page.getByLabel("API key")).toHaveAttribute("placeholder", /Stored/);
  expect(await page.content()).not.toContain("super-secret-key");

  // another host without a key: the API answers 400 api_key_required
  await page.getByLabel("Service URL (https)").fill("https://other.example.test/v1");
  await page.getByRole("button", { name: "Save verifier" }).click();
  await expect(page.getByText("Enter the API key: a new host needs its own key.")).toBeVisible();

  const prisma = createPrisma(process.env.E2E_DATABASE_URL!, 2);
  await prisma.workspace.updateMany({
    data: { verifierLastError: "HTTP 503 from verifier", verifierLastErrorAt: new Date() },
  });
  await prisma.$disconnect();
  await page.reload();
  await expect(page.getByText(/Last verifier error: HTTP 503 from verifier \(.+\)/)).toBeVisible();
});
