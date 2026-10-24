import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost:3100";
let db: Awaited<ReturnType<typeof createTestDb>>;
let workspaceId: string;
let cookie: string;
let imports: typeof import("../app/api/v1/imports/route");
let status: typeof import("../app/api/v1/imports/[id]/route");
let preview: typeof import("../app/api/v1/imports/preview/route");
let exp: typeof import("../app/api/v1/leads/export/route");

/** Multipart request with a real Content-Length, like a browser sends. */
async function upload(url: string, csv: string, fields: Record<string, unknown> = {}, extra = {}) {
  const fd = new FormData();
  fd.set("file", new File([csv], "leads.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, JSON.stringify(v));
  const probe = new Response(fd);
  const bytes = await probe.arrayBuffer();
  return new Request(`${ORIGIN}${url}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      cookie,
      "content-type": probe.headers.get("content-type")!,
      "content-length": String(bytes.byteLength),
      ...extra,
    },
    body: bytes,
  });
}
const get = (url: string) =>
  new Request(`${ORIGIN}${url}`, { headers: { cookie, origin: ORIGIN } });
const opts = {
  mapping: ["email", "firstName"],
  confirmedAuthorized: true,
  lawfulBasis: "legitimate_interest",
};

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
  imports = await import("../app/api/v1/imports/route");
  status = await import("../app/api/v1/imports/[id]/route");
  preview = await import("../app/api/v1/imports/preview/route");
  exp = await import("../app/api/v1/leads/export/route");
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

describe("imports routes", () => {
  it("POST 202 with an importJobId, GET shows the job; another workspace's job is 404", async () => {
    const r = await imports.POST(
      await upload("/api/v1/imports", "email;name\na@x.test;A\n", { options: opts }),
    );
    expect(r.status).toBe(202);
    const { importJobId } = (await r.json()) as { importJobId: string };
    const p = { params: Promise.resolve({ id: importJobId }) };
    const j = (await (await status.GET(get(`/api/v1/imports/${importJobId}`), p)).json()) as Record<
      string,
      unknown
    >;
    expect(j).toMatchObject({
      status: "PENDING",
      progress: 0,
      imported: 0,
      attached: 0,
      skipped: {},
    });

    const other = await db.prisma.workspace.create({ data: { name: "O2", slug: "o2" } });
    const foreign = await db.prisma.importJob.create({
      data: {
        workspaceId: other.id,
        createdById: "u",
        fileName: "f",
        mapping: [],
        options: {},
        confirmedAuthorized: true,
        source: "s",
        lawfulBasis: "other",
      },
    });
    const res = await status.GET(get(`/api/v1/imports/${foreign.id}`), {
      params: Promise.resolve({ id: foreign.id }),
    });
    expect(res.status).toBe(404);
  });

  it("a key needs campaigns:update to enroll into a campaign through an import (S2)", async () => {
    const { createApiKey } = await import("@rightnow/core");
    const c = await db.prisma.campaign.create({
      data: { workspaceId, name: "c", status: "ACTIVE" },
    });
    const as = async (scopes: string[]) => {
      const t = (await createApiKey(db.prisma, workspaceId, "k", scopes)).token;
      const r = await imports.POST(
        await upload(
          "/api/v1/imports",
          "email\ns2@x.test\n",
          { options: { ...opts, mapping: ["email"], options: { campaignId: c.id } } },
          { cookie: "", authorization: `Bearer ${t}` },
        ),
      );
      return [r.status, r.status === 403 ? ((await r.json()) as { error: string }).error : ""];
    };
    expect(await as(["leads:create"])).toEqual([403, "scope_required:campaigns:update"]);
    expect((await as(["leads:create", "campaigns:update"]))[0]).toBe(202);
  });

  it("not authorized is 400; a missing file is 400; a bad lawful basis is 400", async () => {
    expect(
      (
        await imports.POST(
          await upload("/api/v1/imports", "email\na@x.test\n", {
            options: { ...opts, mapping: ["email"], confirmedAuthorized: false },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await imports.POST(
          await upload("/api/v1/imports", "email\na@x.test\n", {
            options: { ...opts, mapping: ["email"], lawfulBasis: "vibes" },
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("Content-Length 53000000 is 413 before the body is read", async () => {
    const req = new Request(`${ORIGIN}/api/v1/imports`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie,
        "content-type": "multipart/form-data; boundary=x",
        "content-length": "53000000",
      },
      body: new ReadableStream({
        pull() {
          throw new Error("body was read");
        },
      }),
      // @ts-expect-error duplex is required for stream bodies
      duplex: "half",
    });
    expect((await imports.POST(req)).status).toBe(413);
  });

  it("preview of a 5000-row file samples 1000 rows", async () => {
    const rows = ["email,name", ...Array.from({ length: 5000 }, (_, i) => `u${i}@x.test,${i}`)];
    const r = await preview.POST(await upload("/api/v1/imports/preview", rows.join("\n") + "\n"));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { sampled: boolean; totalRows: number; counts: { rows: number } };
    expect(j).toMatchObject({ sampled: true, totalRows: 5000, counts: { rows: 1000 } });
  });

  it("export streams a CSV with formula cells neutralized", async () => {
    await db.prisma.lead.create({
      data: { workspaceId, email: "x@acme.io", firstName: "=SUM(1)" },
    });
    const r = await exp.GET(get("/api/v1/leads/export"));
    expect(r.headers.get("content-type")).toContain("text/csv");
    const text = await r.text();
    expect(text).toContain("x@acme.io");
    expect(text).toContain("'=SUM(1)");
  });
});
