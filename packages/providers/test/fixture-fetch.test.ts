import { describe, expect, it } from "vitest";
import { createFixtureFetch } from "../src";

describe("createFixtureFetch", () => {
  it("matches routes, records calls and serves sequences", async () => {
    const f = createFixtureFetch([
      {
        method: "POST",
        url: "https://t.test/token",
        respond: (r) => new Response(r.body, { status: 201 }),
      },
      {
        method: "GET",
        url: /\/items\/\d+$/,
        sequence: [new Response("a"), () => new Response("b", { status: 503 })],
      },
    ]);
    expect((await f("https://t.test/token", { method: "POST", body: "x=1" })).status).toBe(201);
    expect(await (await f("https://t.test/items/1")).text()).toBe("a");
    expect((await f("https://t.test/items/2")).status).toBe(503);
    await expect(f("https://t.test/items/3")).rejects.toThrow(/items\/3/);
    expect(f.calls.map((c) => [c.method, c.order])).toEqual([
      ["POST", 0],
      ["GET", 1],
      ["GET", 2],
      ["GET", 3], // the exhausted request is still recorded
    ]);
    expect(f.calls[0]).toMatchObject({ body: "x=1", url: "https://t.test/token" });
  });

  it("throws on an unmatched request naming the URL", async () => {
    await expect(createFixtureFetch([])("https://nope.test/x")).rejects.toThrow(
      "https://nope.test/x",
    );
  });

  it("records in-flight concurrency", async () => {
    const f = createFixtureFetch([
      {
        method: "GET",
        url: /./,
        respond: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return new Response("");
        },
      },
    ]);
    await Promise.all([f("https://a.test/1"), f("https://a.test/2")]);
    expect(f.calls.map((c) => c.concurrency)).toEqual([1, 2]);
  });
});
