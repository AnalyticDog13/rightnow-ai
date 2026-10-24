import { expect, test, type Page } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// Runs after auth.spec (project dependency). Rows are seeded directly: no provider call, no placement_run job.
const TESTED = "t@pl-e2e.io";
const S1 = "s1@pl-e2e.io";
const S2 = "s2@pl-e2e.io";
let testId = "";
let s2MessageId = "";

test.beforeAll(async () => {
  const prisma = createPrisma(process.env.E2E_DATABASE_URL!, 2);
  const ws = await prisma.workspace.findFirstOrThrow();
  // a retry reruns beforeAll on the same DB: seed once
  if (!(await prisma.emailAccount.count({ where: { email: TESTED } }))) {
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
    const account = (email: string, placementSeed: boolean) =>
      prisma.emailAccount.create({
        data: {
          workspaceId: ws.id,
          email,
          provider: "GMAIL",
          capTier: "GMAIL_WORKSPACE",
          providerCap: 1500,
          fromName: "F",
          firstName: "F",
          lastName: "L",
          placementSeed,
          credentialsEnc,
        },
      });
    const [t, s1, s2] = [
      await account(TESTED, false),
      await account(S1, true),
      await account(S2, true),
    ];
    testId = (
      await prisma.placementTest.create({
        data: { workspaceId: ws.id, accountId: t.id, subject: "Placement e2e" },
      })
    ).id;
    const now = new Date();
    const msg = (to: string, folder: string | null) =>
      prisma.warmupMessage.create({
        data: {
          workspaceId: ws.id,
          fromAccountId: t.id,
          toAccountId: to,
          kind: "PLACEMENT",
          status: "SENT",
          placementTestId: testId,
          rfcMessageId: `<pl-e2e-${to}@pl-e2e.io>`,
          subject: "Placement e2e",
          dueAt: now,
          sentAt: now,
          landedFolder: folder,
        },
      });
    await msg(s1.id, "INBOX");
    await msg(s2.id, null);
  }
  const t = await prisma.emailAccount.findFirstOrThrow({ where: { email: TESTED } });
  testId = (await prisma.placementTest.findFirstOrThrow({ where: { accountId: t.id } })).id;
  const s2 = await prisma.warmupMessage.findFirstOrThrow({
    where: { placementTestId: testId, to: { email: S2 } },
  });
  s2MessageId = s2.id;
  // the test flips this to SPAM; a retry must start from pending again
  await prisma.warmupMessage.update({
    where: { id: s2MessageId },
    data: { landedFolder: null, checkedAt: null },
  });
  await prisma.$disconnect();
});

test.use({ storageState: STATE });
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const row = (page: Page, email: string) => page.getByRole("row").filter({ hasText: email });

test("placement report polls every 15 s and shows a late result", async ({ page }) => {
  await page.clock.install();
  await page.goto("/deliverability/placement");
  await page.getByLabel("Past tests").selectOption(testId);
  await expect(row(page, S1)).toContainText("Inbox");
  await expect(row(page, S2)).toContainText("Waiting for the result");

  const prisma = createPrisma(process.env.E2E_DATABASE_URL!, 2);
  try {
    await prisma.warmupMessage.update({
      where: { id: s2MessageId },
      data: { landedFolder: "SPAM", checkedAt: new Date() },
    });
  } finally {
    await prisma.$disconnect();
  }

  await page.clock.fastForward(15_000);
  await expect(row(page, S2)).toContainText("Spam");
  await expect(row(page, S1)).toContainText("Inbox");
});
