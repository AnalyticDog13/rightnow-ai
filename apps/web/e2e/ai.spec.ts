import { expect, test } from "@playwright/test";
import { runNextJob, systemClock } from "@rightnow/core";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// E2E: the fake AI (`_fake/ai`, answers "Fake AI text") drives "Draft with AI" in the step editor and the bulk
// "Write personalization (AI)" job (run once, directly, as the webhooks spec does). Nothing reaches a lead until approved.
test.use({ storageState: STATE });
test.setTimeout(180_000); // cold route compiles under next dev
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);
async function clean() {
  const prisma = db();
  await prisma.campaign.deleteMany({ where: { name: "E2E AI" } });
  await prisma.lead.deleteMany({ where: { email: { endsWith: "@e2e-ai.io" } } });
  await prisma.aiSuggestion.deleteMany({});
  await prisma.backgroundJob.deleteMany({ where: { kind: "ai_personalize" } });
  await prisma.$disconnect();
}
test.beforeAll(clean);
test.afterAll(clean);

test("draft with AI fills the editor after Use; bulk personalization is applied only to the approved lead", async ({
  page,
  request,
  baseURL,
}) => {
  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  const put = await request.put("/api/v1/settings/ai", {
    data: { baseUrl: `${baseURL}/api/v1/_fake/ai`, apiKey: "e2e-key", model: "fake" },
    headers: { origin: baseURL! },
  });
  expect(put.status()).toBe(200);

  // draft
  const campaign = await prisma.campaign.create({ data: { workspaceId: ws, name: "E2E AI" } });
  const step = await prisma.sequenceStep.create({
    data: { campaignId: campaign.id, order: 1, delayValue: 0 },
  });
  const variant = await prisma.stepVariant.create({
    data: { stepId: step.id, label: "A", subject: "Hello", body: "<p>Original</p>" },
  });
  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByRole("tab", { name: "Sequences", exact: true }).click();
  const group = page.getByRole("group", { name: "Variant A" });
  await group.getByText("Draft with AI").click();
  await group.getByRole("button", { name: "Generate draft" }).click();
  const result = group.getByRole("region", { name: "Generate draft: result" });
  await expect(result).toContainText("Fake AI text");
  await result.getByRole("button", { name: "Use" }).click();
  await expect(group.getByLabel("Body of variant A")).toHaveValue("<p>Fake AI text</p>");
  expect((await prisma.stepVariant.findUniqueOrThrow({ where: { id: variant.id } })).body).toBe(
    "<p>Original</p>", // saved only by the variant's own Save
  );

  // bulk personalization job, approve one of two
  const [ann, bob] = await Promise.all(
    ["ann", "bob"].map((n) =>
      prisma.lead.create({ data: { workspaceId: ws, email: `${n}@e2e-ai.io`, firstName: n } }),
    ),
  );
  await page.goto("/leads");
  await page.getByLabel("Select ann@e2e-ai.io").check();
  await page.getByLabel("Select bob@e2e-ai.io").check();
  await page.getByRole("button", { name: "Write personalization (AI)" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Personalization queued" }),
  ).toBeVisible();
  const signal = new AbortController().signal;
  for (
    let i = 0;
    i < 10 && (await prisma.backgroundJob.count({ where: { status: "PENDING" } }));
    i++
  )
    await runNextJob(prisma, systemClock, signal);
  const review = page.getByRole("region", { name: "AI personalization review" });
  await review.getByRole("button", { name: "Refresh" }).click();
  await expect(review.getByRole("listitem")).toHaveCount(2);
  await review.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(review.getByRole("listitem")).toHaveCount(1);

  const texts = await prisma.lead.findMany({
    where: { id: { in: [ann!.id, bob!.id] } },
    select: { personalization: true },
  });
  expect(texts.map((t) => t.personalization).sort()).toEqual(["Fake AI text", null]);
  await prisma.$disconnect();
});
