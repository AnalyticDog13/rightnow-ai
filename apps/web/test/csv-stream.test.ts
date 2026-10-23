import { describe, expect, it } from "vitest";
import { boardQuery } from "../app/(app)/crm/query";
import { csvStream } from "../lib/csv-stream";

describe("csvStream", () => {
  it("a mid-stream failure ends the file with a marker instead of a silent cut", async () => {
    const chunks = (async function* () {
      yield "a,b\r\n";
      throw new Error("db gone");
    })();
    expect(await new Response(csvStream(chunks)).text()).toBe(
      "a,b\r\n# export failed: incomplete file\r\n",
    );
  });
});

describe("boardQuery", () => {
  it("passes known keys only and maps from/to to the workspace's local day edges", () => {
    expect(
      boardQuery(
        { campaignId: "c", junk: "x", q: "acme", from: "2026-10-31", to: "2026-11-02" },
        "America/New_York",
      ),
    ).toEqual({
      campaignId: "c",
      q: "acme",
      from: "2026-10-31T04:00:00.000Z", // EDT
      to: "2026-11-03T04:59:59.999Z", // EST after the 11-01 change
    });
    expect(boardQuery({ from: "2026-13-01", to: "nope" }, "UTC")).toEqual({});
    expect(boardQuery({ from: "2026-11-02", to: "2026-11-02" }, "UTC")).toEqual({
      from: "2026-11-02T00:00:00.000Z",
      to: "2026-11-02T23:59:59.999Z",
    });
  });
});
