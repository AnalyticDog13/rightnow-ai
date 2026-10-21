import type { DelayUnit } from "@rightnow/db/client";

export { dayKey } from "./accounts/daykey";

/** `days`: bit d = getDay() d in `timezone` (Sun = bit 0). `from`/`to`: "HH:mm", `to` may be "24:00"; to < from runs overnight. */
export type Window = { timezone: string; days: number; from: string; to: string };

/** True for an IANA zone the runtime knows. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

const fmts = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock fields of instant `t` in `tz`; `msOfDay` includes the sub-second part. */
function local(t: number, tz: string) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmts.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, +x.value]));
  const msOfDay = ((p.hour! * 60 + p.minute!) * 60 + p.second!) * 1000 + (((t % 1000) + 1000) % 1000);
  const dow = new Date(Date.UTC(p.year!, p.month! - 1, p.day!)).getUTCDay();
  return { y: p.year!, m: p.month!, d: p.day!, msOfDay, dow };
}

const offsetAt = (t: number, tz: string) => {
  const l = local(t, tz);
  return Date.UTC(l.y, l.m - 1, l.d) + l.msOfDay - t;
};

/**
 * UTC ms of wall-clock `msOfDay` on calendar day y-m-d (d may overflow) in `tz`.
 * Ambiguous (fall-back) time takes the earlier instant; a nonexistent (spring-forward) time moves forward by the gap.
 */
function wallToUtc(y: number, m: number, d: number, msOfDay: number, tz: string): number {
  const want = Date.UTC(y, m - 1, d) + msOfDay;
  const before = offsetAt(want - 864e5, tz);
  const after = offsetAt(want + 864e5, tz);
  const valid = [before, after].map((o) => want - o).filter((t) => offsetAt(t, tz) === want - t);
  return valid.length ? Math.min(...valid) : want - before;
}

/** UTC instant of local 00:00 on `ymd` (YYYY-MM-DD) in `tz`. */
export function localMidnightUtc(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(wallToUtc(y!, m!, d!, 0, tz));
}

/** UTC instant of the next local midnight after `at`. */
export function startOfNextDay(timezone: string, at: Date): Date {
  const l = local(at.getTime(), timezone);
  return new Date(wallToUtc(l.y, l.m, l.d + 1, 0, timezone));
}

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) * 60000;
};
const hasDay = (days: number, dow: number) => (days & (1 << dow)) !== 0;

function inWindow(w: Window, t: number): boolean {
  const l = local(t, w.timezone);
  const f = hm(w.from);
  const e = hm(w.to);
  if (f < e) return hasDay(w.days, l.dow) && l.msOfDay >= f && l.msOfDay < e;
  if (f > e) return (hasDay(w.days, l.dow) && l.msOfDay >= f) || (hasDay(w.days, (l.dow + 6) % 7) && l.msOfDay < e);
  return false; // from == to: empty window
}

/** True when `at` falls inside any window (OR-ed). A window belongs to the local day it opens on. */
export function isInWindow(windows: Window[], at: Date): boolean {
  return windows.some((w) => inWindow(w, at.getTime()));
}

/** `at` when inside a window, else the earliest next opening. Throws when no window can ever open. */
export function nextWindowStart(windows: Window[], at: Date): Date {
  if (isInWindow(windows, at)) return at;
  const now = at.getTime();
  let best = Infinity;
  for (const w of windows) {
    if (hm(w.from) === hm(w.to)) continue;
    const l = local(now, w.timezone);
    for (let k = 0; k < 8; k++) {
      if (!hasDay(w.days, (l.dow + k) % 7)) continue;
      const c = wallToUtc(l.y, l.m, l.d + k, hm(w.from), w.timezone);
      if (c > now) {
        best = Math.min(best, c);
        break;
      }
    }
  }
  if (best === Infinity) throw new Error("no schedule window can open: no allowed day or empty window");
  return new Date(best);
}

/** MINUTES/HOURS are absolute; DAYS keeps the local wall-clock time N calendar days later in `timezone`. */
export function addDelay(from: Date, value: number, unit: DelayUnit, timezone: string): Date {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`bad delay value ${value}`);
  const t = from.getTime();
  if (unit === "MINUTES") return new Date(t + value * 60000);
  if (unit === "HOURS") return new Date(t + value * 3600000);
  if (value === 0) return new Date(t);
  const l = local(t, timezone);
  return new Date(wallToUtc(l.y, l.m, l.d + value, l.msOfDay, timezone));
}
