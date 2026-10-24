export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(d: Date): Clock & { advance(ms: number): void } {
  let t = d.getTime();
  return {
    now: () => new Date(t),
    advance(ms) {
      t += ms;
    },
  };
}

/** Resolves after `ms`, or at once when `signal` aborts. */
export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((r) => {
    if (signal?.aborted) return r();
    const t = setTimeout(r, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
  });
