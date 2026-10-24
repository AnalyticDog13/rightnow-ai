import { describe, expect, it } from "vitest";
import { latest, outsideClose } from "../app/(app)/analytics/guards";
import {
  apiParams,
  csvText,
  preset,
  rateTip,
  todayIn,
} from "../app/(app)/analytics/query";

describe("analytics UI helpers", () => {
  it("rateTip prints numerator, denominator and base", () => {
    expect(rateTip(3, 12, "contacted")).toBe("3 of 12 contacted");
    expect(rateTip(0, 0, "sent")).toBe("0 of 0 sent");
  });

  it("preset counts back inclusive days from today", () => {
    expect(preset(7, "2026-03-10")).toEqual({
      from: "2026-03-04",
      to: "2026-03-10",
    });
    expect(preset(30, "2026-03-01")).toEqual({
      from: "2026-01-31",
      to: "2026-03-01",
    });
  });

  it("apiParams keeps known filters, fills the range and zone, adds groupBy", () => {
    const sp = new URLSearchParams(
      "campaignIds=a,b&junk=1&from=2026-01-01&to=2026-01-31&esp=GOOGLE",
    );
    const p = apiParams(sp, { tz: "UTC", today: "2026-02-01" }, "step");
    expect(Object.fromEntries(p)).toEqual({
      campaignIds: "a,b",
      from: "2026-01-01",
      to: "2026-01-31",
      esp: "GOOGLE",
      tz: "UTC",
      groupBy: "step",
    });
    const d = apiParams(new URLSearchParams(), {
      tz: "Europe/Paris",
      today: "2026-02-01",
    });
    expect(Object.fromEntries(d)).toEqual({
      from: "2026-01-03",
      to: "2026-02-01",
      tz: "Europe/Paris",
    });
  });

  it("csvText quotes cells and defuses formulas", () => {
    expect(csvText([["a", 'x"y', "=SUM(1)", 2]])).toBe(
      'a,"x""y",\'=SUM(1),2\r\n',
    );
  });

  it("csvText keeps plain numbers, including negatives, unquoted", () => {
    expect(csvText([[-5, "-5", "-x"]])).toBe("-5,-5,'-x\r\n");
  });

  it("todayIn falls back to the UTC day for a zone the browser does not know", () => {
    expect(todayIn("Bogus/Zone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIn("UTC")).toBe(new Date().toISOString().slice(0, 10));
  });
  it("a stale loadVariants answer that lands after a newer one is ignored", async () => {
    const guard = latest();
    const applied: string[] = [];
    const load = async (name: string, ms: number) => {
      const seq = guard.next();
      await new Promise((r) => setTimeout(r, ms));
      if (guard.stale(seq)) return;
      applied.push(name);
    };
    await Promise.all([load("old", 30), load("new", 5)]);
    expect(applied).toEqual(["new"]);
  });

  it("an outside click closes the metric menu, an inside click does not", () => {
    const inside = {};
    const box = { contains: (n: unknown) => n === inside };
    let closed = 0;
    outsideClose(box, () => closed++)({ target: inside });
    expect(closed).toBe(0);
    outsideClose(box, () => closed++)({ target: {} });
    expect(closed).toBe(1);
    outsideClose(null, () => closed++)({ target: inside });
    expect(closed).toBe(2);
  });
});
