/** Retry-After as seconds or HTTP-date, clamped to 1..3600; unparseable -> fallbackSec. */
export function parseRetryAfter(header: string | null, now: Date, fallbackSec = 60): number {
  const h = header?.trim();
  let sec = fallbackSec;
  if (h && /^\d+(\.\d+)?$/.test(h)) sec = Math.ceil(Number(h));
  else if (h && !Number.isNaN(Date.parse(h)))
    sec = Math.ceil((Date.parse(h) - now.getTime()) / 1000);
  return Math.min(3600, Math.max(1, sec));
}
