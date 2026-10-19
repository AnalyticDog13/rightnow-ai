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
