import type { RemoteMessage } from "./types";

/** Maps with at most `n` calls in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: T[],
  n: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

export const DEFAULT_PAGE_BYTES = 20 * 1024 * 1024;

/**
 * Reads `ids` in order, `n` at a time, until about `maxBytes` of raw content are held (I-9: a page never holds much more
 * than ~20 MB). `consumed` = the ids read, in order; fewer than `ids` when the cap cut the page short.
 */
export async function readCapped(
  ids: string[],
  n: number,
  maxBytes: number,
  read: (id: string) => Promise<{ msg: RemoteMessage; bytes: number } | null>,
): Promise<{ messages: RemoteMessage[]; consumed: string[] }> {
  const messages: RemoteMessage[] = [];
  let bytes = 0;
  let i = 0;
  while (i < ids.length && bytes < maxBytes) {
    const chunk = ids.slice(i, (i += n));
    for (const r of await mapLimit(chunk, n, read))
      if (r) {
        messages.push(r.msg);
        bytes += r.bytes;
      }
  }
  return { messages, consumed: ids.slice(0, i) };
}
