import { expect, test } from "@playwright/test";
import { createPrisma } from "@rightnow/db/create";
import { ensureSession, STATE } from "./session";

// E2E #13: revenue fields on a deal, validation, and the ADMIN stage settings. Runs after auth.spec. It only creates
// throwaway "E2E *" stages (never edits the defaults), so it does not depend on the order of the specs.
test.use({ storageState: STATE });
test.setTimeout(180_000); // cold route compiles under next dev
test.beforeAll(async ({ playwright, baseURL }) => ensureSession(playwright, baseURL!));

const db = () => createPrisma(process.env.E2E_DATABASE_URL!, 2);
const ORIGIN = { origin: "http://localhost:3100" };

async function clean() {
  const prisma = db();
  const leads = { lead: { email: { endsWith: "@e2e-rev.io" } } };
  await prisma.task.deleteMany({ where: leads });
  await prisma.opportunity.deleteMany({ where: leads });
  await prisma.lead.deleteMany({ where: { email: { endsWith: "@e2e-rev.io" } } });
  await prisma.$disconnect();
}
test.beforeAll(clean);
test.afterAll(clean);

type Stages = { stages: { id: string; name: string }[] };

// The test only creates throwaway "E2E *" stages; this removes whatever of them is left (also after a failure or a
// retry), so the default pipeline other specs rely on is never touched.
test.afterEach(async ({ page }) => {
  const stages = ((await (await page.request.get("/api/v1/crm/stages")).json()) as Stages).stages;
  const contacted = stages.find((s) => s.name === "Contacted")!.id;
  for (const s of stages.filter((x) => x.name.startsWith("E2E "))) {
    const r = await page.request.delete(`/api/v1/crm/stages/${s.id}?moveTo=${contacted}`, {
      headers: ORIGIN,
    });
    expect(r.status()).toBe(200);
  }
});

test("value, close date, cash collected, validation, stage settings", async ({ page }) => {
  const prisma = db();
  const ws = (await prisma.workspace.findFirstOrThrow()).id;
  const a = await prisma.lead.create({ data: { workspaceId: ws, email: "rev@e2e-rev.io" } });
  const b = await prisma.lead.create({ data: { workspaceId: ws, email: "move@e2e-rev.io" } });
  await prisma.$disconnect();
  const stage = async (name: string) => {
    const r = await page.request.post("/api/v1/crm/stages", {
      data: { name, kind: "OPEN" },
      headers: ORIGIN,
    });
    expect(r.status()).toBe(200);
    return ((await r.json()) as { id: string }).id;
  };
  await stage("E2E Rename");
  const doomed = await stage("E2E Doomed");
  const make = (leadId: string, title: string, stageId?: string) =>
    page.request.post("/api/v1/crm/opportunities", {
      data: { leadId, title, stageId },
      headers: ORIGIN,
    });
  expect((await make(a.id, "Revenue deal")).status()).toBe(200);
  expect((await make(b.id, "Proposal deal", doomed)).status()).toBe(200);

  await page.goto("/crm");
  const column = (name: string) => page.getByRole("region", { name, exact: true });
  const open = async () => {
    await page.getByRole("button", { name: "Open Revenue deal" }).click();
    return page.getByRole("dialog", { name: "Revenue deal" });
  };
  const save = async (drawer: ReturnType<typeof page.getByRole>) => {
    const r = page.waitForResponse(
      (x) => /\/crm\/opportunities\/[^/]+$/.test(x.url()) && x.request().method() === "PATCH",
    );
    await drawer.getByRole("button", { name: "Save" }).click();
    expect((await r).status()).toBe(200);
  };

  let drawer = await open();
  await drawer.getByLabel("Value").fill("5000");
  await drawer.getByLabel("Expected close").fill("2027-03-01");
  await save(drawer);
  await drawer.getByLabel("Stage", { exact: true }).selectOption({ label: "Closed Won" });
  await save(drawer);
  await drawer.getByLabel("Cash collected").fill("4500");
  await save(drawer);
  await expect(drawer.getByText(/^Closed on /)).toBeVisible();
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(column("Closed Won")).toContainText("$5,000.00");

  // survives a reload
  await page.reload();
  await expect(column("Closed Won")).toContainText("$5,000.00");
  drawer = await open();
  await expect(drawer.getByLabel("Value")).toHaveValue("5000");
  await expect(drawer.getByLabel("Cash collected")).toHaveValue("4500");
  await expect(drawer.getByLabel("Expected close")).toHaveValue("2027-03-01");
  await expect(drawer.getByText(/^Closed on /)).toBeVisible();

  // a negative value is a field error and nothing is sent
  let patches = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/crm/opportunities/")) patches++;
  });
  await drawer.getByLabel("Value").fill("-5");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByRole("alert")).toContainText("Value must be 0 or more");
  await expect(drawer.getByLabel("Value")).toHaveAttribute("aria-invalid", "true");
  expect(patches).toBe(0);
  await drawer.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(column("Closed Won")).toContainText("$5,000.00");

  // ADMIN stage settings
  await page.getByRole("tab", { name: "Pipeline settings" }).click();
  const rename = page.getByRole("group", { name: "Stage E2E Rename", exact: true });
  await rename.getByRole("textbox", { name: "Name", exact: true }).fill("E2E Renamed");
  const renamed = page.waitForResponse(
    (r) => /\/crm\/stages\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH",
  );
  await rename.getByRole("button", { name: "Save" }).click();
  expect((await renamed).status()).toBe(200);
  await expect(page.getByRole("group", { name: "Stage E2E Renamed" })).toBeVisible();

  const del = page.getByRole("group", { name: "Stage E2E Doomed" });
  const moveTo = del.getByLabel("Move deals to");
  await expect(moveTo.getByRole("option", { name: "Contacted", exact: true })).toHaveCount(1);
  await expect(moveTo.getByRole("option", { name: "Closed Won" })).toHaveCount(0);
  await expect(moveTo.getByRole("option", { name: "Closed Lost" })).toHaveCount(0);
  await expect(del.getByRole("button", { name: "Delete" })).toBeDisabled();
  await moveTo.selectOption({ label: "Contacted" });
  const gone = page.waitForResponse(
    (r) => /\/crm\/stages\/[^/]+/.test(r.url()) && r.request().method() === "DELETE",
  );
  await del.getByRole("button", { name: "Delete" }).click();
  expect((await gone).status()).toBe(200);
  await expect(page.getByRole("group", { name: "Stage E2E Doomed" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Opportunities" }).click();
  await expect(column("Contacted").getByText("Proposal deal")).toBeVisible();
});
