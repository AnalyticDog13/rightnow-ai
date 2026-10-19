import { expect, test } from "vitest";
import { fixedClock, systemClock } from "../src/clock";

test("fixedClock stays put until advanced", () => {
  const c = fixedClock(new Date("2026-01-01T00:00:00Z"));
  expect(c.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  c.advance(1500);
  expect(c.now().toISOString()).toBe("2026-01-01T00:00:01.500Z");
});

test("systemClock returns current time", () => {
  expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
});
