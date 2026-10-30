import { describe, expect, it } from "vitest";
import { filterItems } from "../components/command-palette";
import { healthBand } from "../components/health-ring";
import { sendState } from "../components/send-meter";
import { isCurrent, NAV } from "../lib/nav";

const item = (href: string) => NAV.find((n) => n.href === href)!;

describe("UI helpers (design spec B3, B4)", () => {
  it("send meter state: idle without campaigns, done at the allowance, else sending", () => {
    expect(sendState({ campaigns: [], remainingToday: 5 })).toBe("Idle");
    expect(sendState({ campaigns: [{}], remainingToday: 0 })).toBe("Done for today");
    expect(sendState({ campaigns: [{}], remainingToday: 3 })).toBe("Sending");
  });

  it("health bands: 90+ good, 70-89 fair, below poor, null not enough data", () => {
    expect([90, 89, 70, 69, null].map((s) => healthBand(s).word)).toEqual([
      "Good",
      "Fair",
      "Fair",
      "Poor",
      "Not enough data",
    ]);
  });

  it("nav items are current on sub-routes and sibling routes only", () => {
    expect(isCurrent(item("/campaigns"), "/campaigns/abc")).toBe(true);
    expect(isCurrent(item("/campaigns"), "/scheduled")).toBe(true);
    expect(isCurrent(item("/leads"), "/leads/lists")).toBe(true);
    expect(isCurrent(item("/leads"), "/blocklist")).toBe(true);
    expect(isCurrent(item("/settings"), "/settings/api-keys")).toBe(true);
    expect(isCurrent(item("/leads"), "/leadsx")).toBe(false);
    expect(isCurrent(item("/dashboard"), "/accounts")).toBe(false);
  });

  it("palette filter is a case-insensitive substring match on labels", () => {
    expect(filterItems("API").map((i) => i.label)).toEqual(["API keys"]);
    expect(filterItems("  ").length).toBe(filterItems("").length);
    expect(filterItems("zzz")).toEqual([]);
  });
});
