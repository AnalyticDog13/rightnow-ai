import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@rightnow/db/test-db";
import { createFirstOwner } from "../lib/setup";

const TOKEN = "t".repeat(20);
const input = (email: string, token = TOKEN) => ({
  name: "N",
  email,
  password: "correct horse battery",
  workspaceName: "Acme Co",
  token,
});

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("createFirstOwner", () => {
  it("wrong token -> 403 and nothing created", async () => {
    await expect(createFirstOwner(db.prisma, input("a@x.io", "nope"), TOKEN)).rejects.toMatchObject(
      { status: 403 },
    );
    expect(await db.prisma.user.count()).toBe(0);
  });

  it("two concurrent first-owner sign-ups -> exactly one succeeds", async () => {
    const results = await Promise.allSettled(
      ["a@x.io", "b@x.io", "c@x.io", "d@x.io"].map((e) =>
        createFirstOwner(db.prisma, input(e), TOKEN),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results)
      if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
    expect(await db.prisma.user.count()).toBe(1);
    expect(await db.prisma.member.findMany({ select: { role: true } })).toEqual([
      { role: "owner" },
    ]);
    expect(await db.prisma.workspace.count()).toBe(1);
  });

  it("later calls are rejected", async () => {
    await expect(createFirstOwner(db.prisma, input("z@x.io"), TOKEN)).rejects.toMatchObject({
      status: 409,
    });
  });
});
