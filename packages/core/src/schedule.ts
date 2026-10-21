/** True for an IANA zone the runtime knows. (T07 extends this file with the window maths.) */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

/** UTC instant of local 00:00 on `ymd` (YYYY-MM-DD) in `tz`. Two passes settle DST offsets. */
export function localMidnightUtc(ymd: string, tz: string): Date {
  const want = Date.parse(`${ymd}T00:00:00Z`);
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(t)
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - t;
  };
  let t = want - offset(want);
  t = want - offset(t);
  return new Date(t);
}
