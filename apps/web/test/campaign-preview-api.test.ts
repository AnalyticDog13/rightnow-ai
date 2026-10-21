import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { getFakeProvider } from "@rightnow/providers";
import { seedCampaign } from "../../../packages/core/test/campaign-fixture";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "https://app.example.com";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let preview: typeof import("../app/api/v1/campaigns/[id]/preview/route");
let testSend: typeof import("../app/api/v1/campaigns/[id]/test-send/route");

const req = (method: string, body?: unknown, headers: Record<string, string> = { cookie }) =>
  new Request(`${ORIGIN}/x`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const setRole = (role: string) =>
  db.prisma.member.updateMany({ where: { workspaceId }, data: { role } });

beforeAll(async () => {
  db = await createTestDb();
  Object.assign(process.env, {
    MODE: "local",
    MAIL_PROVIDER_FAKE: "1",
    FAKE_MAIL_DIR: mkdtempSync(join(tmpdir(), "rn-web-")),
    DATABASE_URL: db.url,
    APP_URL: ORIGIN,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    BETTER_AUTH_SECRET: "x".repeat(40),
    SETUP_TOKEN: TOKEN,
  });
  const { auth } = await import("../lib/auth");
  preview = await import("../app/api/v1/campaigns/[id]/preview/route");
  testSend = await import("../app/api/v1/campaigns/[id]/test-send/route");
  ({ workspaceId } = await createFirstOwner(
    db.prisma,
    { name: "O", email: "owner@x.io", password: PASSWORD, workspaceName: "Acme", token: TOKEN },
    TOKEN,
  ));
  const { headers } = await auth.api.signInEmail({
    body: { email: "owner@x.io", password: PASSWORD },
    returnHeaders: true,
  });
  cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});
afterAll(async () => {
  await db.drop();
});

it("preview is a read for VIEWER; test-send is ADMIN, blocks on issues and disables the lead's unsubscribe link", async () => {
  const P = db.prisma;
  await P.workspace.update({ where: { id: workspaceId }, data: { physicalAddress: "1 Main St" } });
  const s = await seedCampaign(P, { at: new Date(), workspaceId, leads: 1, accounts: [{}] });
  const a = s.accounts[0]!;
  const { encryptCredentials } = await import("@rightnow/core");
  await P.emailAccount.update({
    where: { id: a.id },
    data: {
      provider: "GMAIL",
      credentialsEnc: encryptCredentials({
        kind: "oauth",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: 1,
        scope: "s",
      }),
    },
  });
  const v = s.steps[0]!.variant;
  await P.stepVariant.update({
    where: { id: v.id },
    data: { subject: "Hi {{firstName | there}}", body: "<p>Body</p>" },
  });
  const ref = { stepId: s.steps[0]!.id, variantId: v.id, leadId: s.leads[0]!.lead.id };
  const id = s.campaign.id;

  await setRole("VIEWER");
  const r = await preview.POST(req("POST", ref), p(id));
  expect(r.status).toBe(200);
  const shown = (await r.json()) as { subject: string; issues: unknown[]; text: string };
  expect(shown).toMatchObject({ subject: "Hi there", issues: [] });
  // gate M-5: a reader never sees the lead's live unsubscribe token
  expect(shown.text).not.toContain("/u/");
  expect(shown.text).toContain("(unsubscribe disabled");
  expect((await preview.POST(req("POST", { ...ref, leadId: "nope" }), p(id))).status).toBe(404);
  expect((await preview.POST(req("POST", { ...ref, extra: 1 }), p(id))).status).toBe(400);

  const body = { ...ref, to: "t@dest.example", confirmAuthorized: true };
  expect((await testSend.POST(req("POST", body), p(id))).status).toBe(403);
  await setRole("OWNER");
  expect(
    (await testSend.POST(req("POST", { ...body, confirmAuthorized: false }), p(id))).status,
  ).toBe(400);
  expect((await testSend.POST(req("POST", body), p(id))).status).toBe(200);
  const [m] = (await getFakeProvider(a.email).listMessages({ since: new Date(0), folder: "SENT" }))
    .messages;
  expect(m!.subject).toBe("Hi there");
  expect(m!.headers["x-rightnow-test"]).toEqual(["1"]);
  expect(m!.text).toContain("1 Main St");
  expect(m!.text).not.toContain("/u/");

  // gate M-4: never to a suppressed address (same check as the claim, domain entries included)
  const { suppress } = await import("@rightnow/core");
  await suppress(P, workspaceId, [{ kind: "DOMAIN", value: "gone.example" }], "MANUAL", "test");
  const refused = await testSend.POST(req("POST", { ...body, to: "x@gone.example" }), p(id));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: "recipient_suppressed" });

  await P.stepVariant.update({ where: { id: v.id }, data: { body: "{{nope}}" } });
  const bad = await testSend.POST(req("POST", body), p(id));
  expect(bad.status).toBe(422);
  expect(((await bad.json()) as { issues: { code: string }[] }).issues[0]!.code).toBe(
    "unknown_variable",
  );
});
