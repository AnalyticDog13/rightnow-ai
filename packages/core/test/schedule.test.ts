import { describe, expect, test } from "vitest";
import {
  addDelay,
  dayKey,
  isInWindow,
  isValidTimeZone,
  nextWindowStart,
  startOfNextDay,
  type Window,
} from "../src/schedule";

const d = (s: string) => new Date(s);
const iso = (x: Date) => x.toISOString();
const NY = "America/New_York";
const weekday: Window = { timezone: NY, days: 0b0111110, from: "09:00", to: "17:00" }; // Mon-Fri (Sun = bit 0)

describe("isInWindow", () => {
  test("Mon-Fri 09-17 New York", () => {
    expect(isInWindow([weekday], d("2026-10-19T13:00:00Z"))).toBe(true); // Mon 09:00 EDT
    expect(isInWindow([weekday], d("2026-10-19T12:59:59Z"))).toBe(false);
    expect(isInWindow([weekday], d("2026-10-19T21:00:00Z"))).toBe(false); // 17:00 excluded
    expect(isInWindow([weekday], d("2026-10-19T20:59:59Z"))).toBe(true);
    expect(isInWindow([weekday], d("2026-10-24T15:00:00Z"))).toBe(false); // Sat
  });

  test("overnight Mon-only 22:00-06:00 UTC belongs to the opening day", () => {
    const w: Window = { timezone: "UTC", days: 0b0000010, from: "22:00", to: "06:00" };
    expect(isInWindow([w], d("2026-10-19T23:00:00Z"))).toBe(true); // Mon
    expect(isInWindow([w], d("2026-10-20T05:59:00Z"))).toBe(true); // Tue, Monday's window
    expect(isInWindow([w], d("2026-10-20T06:00:00Z"))).toBe(false);
    expect(isInWindow([w], d("2026-10-20T23:00:00Z"))).toBe(false); // Tue evening
    expect(isInWindow([w], d("2026-10-19T05:00:00Z"))).toBe(false); // Mon morning is Sunday's
  });

  test("to 24:00 runs to local midnight; multiple windows are OR-ed", () => {
    const a: Window = { timezone: "UTC", days: 0b1111111, from: "20:00", to: "24:00" };
    const b: Window = { timezone: "Asia/Tokyo", days: 0b1111111, from: "09:00", to: "10:00" };
    expect(isInWindow([a], d("2026-10-19T23:59:59Z"))).toBe(true);
    expect(isInWindow([a], d("2026-10-20T00:00:00Z"))).toBe(false);
    expect(isInWindow([a, b], d("2026-10-19T00:30:00Z"))).toBe(true); // 09:30 JST
  });

  test("no windows is never in", () => {
    expect(isInWindow([], d("2026-10-19T13:00:00Z"))).toBe(false);
  });
});

describe("nextWindowStart", () => {
  test("inside returns at", () => {
    const at = d("2026-10-19T15:00:00Z");
    expect(nextWindowStart([weekday], at)).toBe(at);
  });
  test("before the window opens the same day", () => {
    expect(iso(nextWindowStart([weekday], d("2026-10-19T10:00:00Z")))).toBe("2026-10-19T13:00:00.000Z");
  });
  test("after close rolls to next weekday; Friday evening and Saturday roll to Monday", () => {
    expect(iso(nextWindowStart([weekday], d("2026-10-19T22:00:00Z")))).toBe("2026-10-20T13:00:00.000Z");
    expect(iso(nextWindowStart([weekday], d("2026-10-23T22:00:00Z")))).toBe("2026-10-26T13:00:00.000Z");
    expect(iso(nextWindowStart([weekday], d("2026-10-24T12:00:00Z")))).toBe("2026-10-26T13:00:00.000Z");
  });
  test("crosses the fall-back date with the new offset", () => {
    // Fri 2026-10-30 evening -> Mon 2026-11-02 09:00 EST = 14:00Z
    expect(iso(nextWindowStart([weekday], d("2026-10-31T01:00:00Z")))).toBe("2026-11-02T14:00:00.000Z");
  });
  test("multiple schedules: earliest wins", () => {
    const tokyo: Window = { timezone: "Asia/Tokyo", days: 0b1111111, from: "09:00", to: "10:00" };
    // Sat 12:00Z: NY next is Mon 13:00Z; Tokyo next is Sun 00:00Z
    expect(iso(nextWindowStart([weekday, tokyo], d("2026-10-24T12:00:00Z")))).toBe("2026-10-25T00:00:00.000Z");
  });
  test("overnight: after the end goes to the next opening", () => {
    const w: Window = { timezone: "UTC", days: 0b0000010, from: "22:00", to: "06:00" };
    expect(iso(nextWindowStart([w], d("2026-10-20T06:00:00Z")))).toBe("2026-10-26T22:00:00.000Z");
  });
  test("no allowed days throws, as do no windows", () => {
    expect(() => nextWindowStart([{ ...weekday, days: 0 }], d("2026-10-19T00:00:00Z"))).toThrow();
    expect(() => nextWindowStart([], d("2026-10-19T00:00:00Z"))).toThrow();
  });
  test("empty (from == to) window throws instead of looping", () => {
    expect(() => nextWindowStart([{ ...weekday, from: "09:00", to: "09:00" }], d("2026-10-19T00:00:00Z"))).toThrow();
  });
  test("London fall-back: 01:00-02:00 window returns the first 01:00", () => {
    const w: Window = { timezone: "Europe/London", days: 0b1111111, from: "01:00", to: "02:00" };
    expect(iso(nextWindowStart([w], d("2026-10-24T23:30:00Z")))).toBe("2026-10-25T00:00:00.000Z");
    // the repeated hour is the same window: 00:00Z..02:00Z, opened once
    expect(isInWindow([w], d("2026-10-25T01:30:00Z"))).toBe(true);
    expect(iso(nextWindowStart([w], d("2026-10-25T02:00:00Z")))).toBe("2026-10-26T01:00:00.000Z");
  });
  test("New York spring-forward: window opening inside the gap opens after the gap", () => {
    const w: Window = { timezone: NY, days: 0b1111111, from: "02:30", to: "04:00" };
    expect(iso(nextWindowStart([w], d("2026-03-08T06:00:00Z")))).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
  });
  test("zone without DST (Asia/Kolkata, +05:30)", () => {
    const w: Window = { timezone: "Asia/Kolkata", days: 0b1111111, from: "09:00", to: "10:00" };
    expect(iso(nextWindowStart([w], d("2026-07-01T05:00:00Z")))).toBe("2026-07-02T03:30:00.000Z");
  });
});

describe("addDelay", () => {
  test("minutes and hours are exact across DST", () => {
    expect(iso(addDelay(d("2026-03-08T06:30:00Z"), 1, "HOURS", NY))).toBe("2026-03-08T07:30:00.000Z");
    expect(iso(addDelay(d("2026-03-08T06:30:00Z"), 90, "MINUTES", NY))).toBe("2026-03-08T08:00:00.000Z");
    expect(iso(addDelay(d("2026-11-01T05:30:00Z"), 24, "HOURS", NY))).toBe("2026-11-02T05:30:00.000Z");
  });
  test("days keep local wall-clock across spring-forward", () => {
    expect(iso(addDelay(d("2026-03-07T12:00:00Z"), 1, "DAYS", NY))).toBe("2026-03-08T11:00:00.000Z");
  });
  test("days keep local wall-clock across fall-back", () => {
    expect(iso(addDelay(d("2026-10-31T12:00:00Z"), 1, "DAYS", NY))).toBe("2026-11-01T13:00:00.000Z"); // 08:00 EDT -> 08:00 EST
  });
  test("a nonexistent local time moves forward by the gap", () => {
    // Mar 7 02:30 EST (07:30Z) + 1 day: 02:30 on Mar 8 does not exist -> 03:30 EDT = 07:30Z
    expect(iso(addDelay(d("2026-03-07T07:30:00Z"), 1, "DAYS", NY))).toBe("2026-03-08T07:30:00.000Z");
  });
  test("an ambiguous local time takes the earlier offset", () => {
    // Oct 31 01:30 EDT (05:30Z) + 1 day: 01:30 Nov 1 occurs twice -> EDT (05:30Z)
    expect(iso(addDelay(d("2026-10-31T05:30:00Z"), 1, "DAYS", NY))).toBe("2026-11-01T05:30:00.000Z");
  });
  test("London days, multi-day, and millis preserved", () => {
    expect(iso(addDelay(d("2026-10-24T12:00:00.250Z"), 2, "DAYS", "Europe/London"))).toBe("2026-10-26T13:00:00.250Z");
    expect(iso(addDelay(d("2026-03-25T12:00:00Z"), 7, "DAYS", "Europe/London"))).toBe("2026-04-01T11:00:00.000Z");
  });
  test("zero is identity; negative or fractional input throws", () => {
    expect(iso(addDelay(d("2026-10-24T12:00:00Z"), 0, "DAYS", NY))).toBe("2026-10-24T12:00:00.000Z");
    expect(() => addDelay(d("2026-10-24T12:00:00Z"), -1, "DAYS", NY)).toThrow();
    expect(() => addDelay(d("2026-10-24T12:00:00Z"), 1.5, "HOURS", NY)).toThrow();
  });
});

describe("startOfNextDay / dayKey / isValidTimeZone", () => {
  test("startOfNextDay", () => {
    expect(iso(startOfNextDay("Pacific/Auckland", d("2026-03-01T12:00:00Z")))).toBe("2026-03-02T11:00:00.000Z");
    expect(iso(startOfNextDay(NY, d("2026-03-08T12:00:00Z")))).toBe("2026-03-09T04:00:00.000Z"); // 23 h day
    expect(iso(startOfNextDay(NY, d("2026-11-01T12:00:00Z")))).toBe("2026-11-02T05:00:00.000Z"); // 25 h day
  });
  test("dayKey at local midnight boundaries and across DST", () => {
    expect(dayKey(NY, d("2026-10-20T03:59:59Z"))).toBe("2026-10-19"); // 23:59:59 EDT
    expect(dayKey(NY, d("2026-10-20T04:00:00Z"))).toBe("2026-10-20");
    expect(dayKey(NY, d("2026-11-02T04:59:59Z"))).toBe("2026-11-01"); // 23:59:59 EST
    expect(dayKey(NY, d("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
    expect(dayKey(NY, d("2026-03-08T04:59:59Z"))).toBe("2026-03-07");
    expect(dayKey("Europe/London", d("2026-10-25T23:59:59Z"))).toBe("2026-10-25");
    expect(dayKey("Europe/London", d("2026-10-26T00:00:00Z"))).toBe("2026-10-26");
  });
  test("isValidTimeZone", () => {
    expect(isValidTimeZone("EST5EDT")).toBe(true);
    expect(isValidTimeZone("Mars/Phobos")).toBe(false);
  });
});
