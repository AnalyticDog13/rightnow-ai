import { expect, test } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// E2E: the Dashboard tiles, due tasks and account strip over seeded data. Runs after auth.spec.
test.use({ storageState: STATE });
test.setTimeout(180_000); // cold route compiles under next dev
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);
const DAY = 86_400_000;
const EMAIL = "dash@e2e-dash.test";

async function clean() {
  const prisma = db();
  await prisma.task.deleteMany({ where: { title: "E2E due task" } });
  await prisma.emailAccount.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
}
test.beforeAll(async () => {
  await clean();
  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  const account = await prisma.emailAccount.create({
    data: {
      workspaceId: ws,
      provider: "SMTP",
      email: EMAIL,
      fromName: "Dash",
      firstName: "Dash",
      lastName: "Board",
      capTier: "SMTP",
      providerCap: 100,
      credentialsEnc: "x",
    },
  });
  // three days, so one of them is today in the account zone whatever the zone is
  for (const d of [-1, 0, 1])
    await prisma.accountDailyUsage.create({
      data: {
        accountId: account.id,
        day: new Date(`${new Date(Date.now() + d * DAY).toISOString().slice(0, 10)}T00:00:00Z`),
        sent: 3,
      },
    });
  await prisma.task.create({
    data: { workspaceId: ws, title: "E2E due task", dueAt: new Date(Date.now() - 3600_000) },
  });
  await prisma.$disconnect();
});
test.afterAll(clean);

test("tiles match the API; a due task links to CRM Tasks; the strip lists health", async ({
  page,
}) => {
  const api = await (await page.request.get("/api/v1/dashboard")).json();
  expect(api.sentToday).toBeGreaterThanOrEqual(3);

  await page.goto("/dashboard");
  const sent = page.getByRole("group", { name: "Sent today" });
  await expect(sent).toContainText(`${api.sentToday} / ${api.allowanceToday}`);
  await expect(sent).toHaveAttribute("title", "Accepted by the provider (not proof of delivery)");
  await expect(page.getByRole("group", { name: "Remaining capacity" })).toContainText(
    String(api.remainingToday),
  );
  await expect(page.getByRole("group", { name: "Reply rate", exact: true })).toHaveAttribute(
    "title",
    /\d+ of \d+ contacted/,
  );

  const mine = api.accounts.find((a: { email: string }) => a.email === EMAIL);
  await expect(page.getByRole("listitem").filter({ hasText: EMAIL })).toContainText(
    `health ${mine.healthScore ?? "n/a"}`,
  );

  await page.getByRole("link", { name: "E2E due task" }).click();
  await expect(page).toHaveURL(/\/crm\?tab=tasks/);
  await expect(page.getByText("E2E due task")).toBeVisible();
});
