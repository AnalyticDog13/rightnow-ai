import { PermanentSendError } from "./errors";
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

const CUT = "rn-cut:";

/**
 * A byte-capped `listMessages` page (I-9). When the cap cuts the provider's page short, the returned token is ours:
 * the provider's token of that page (none = the first page) plus the ids already returned, so the next call reads
 * the same page again and returns only the rest. A token we cannot parse is refused like a stale one (M11).
 */
export async function listCapped(
  pageToken: string | undefined,
  n: number,
  maxBytes: number,
  page: (token: string | undefined) => Promise<{ ids: string[]; next?: string }>,
  read: (id: string) => Promise<{ msg: RemoteMessage; bytes: number } | null>,
): Promise<{ messages: RemoteMessage[]; nextPageToken?: string }> {
  let token = pageToken;
  let done = new Set<string>();
  if (pageToken?.startsWith(CUT))
    try {
      const x = JSON.parse(pageToken.slice(CUT.length)) as { t: string | null; d: string[] };
      token = x.t ?? undefined;
      done = new Set(x.d);
    } catch {
      throw new PermanentSendError("page_token_invalid");
    }
  const r = await page(token);
  const ids = r.ids.filter((id) => !done.has(id));
  const { messages, consumed } = await readCapped(ids, n, maxBytes, read);
  const next =
    consumed.length < ids.length
      ? CUT + JSON.stringify({ t: token ?? null, d: [...done, ...consumed] })
      : r.next;
  return { messages, ...(next ? { nextPageToken: next } : {}) };
}
