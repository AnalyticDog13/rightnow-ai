/** Stale-answer guard: take a ticket before a request, drop the answer if a newer ticket was taken meanwhile. */
export function latest() {
  let n = 0;
  return { next: () => ++n, stale: (t: number) => t !== n };
}

/** A mousedown handler that calls `close` when the target is outside `box`. */
export const outsideClose =
  (box: { contains(n: Node | null): boolean } | null, close: () => void) =>
  (e: { target: unknown }) => {
    if (!box?.contains(e.target as Node)) close();
  };
