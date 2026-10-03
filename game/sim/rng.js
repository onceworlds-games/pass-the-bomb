// Seeded random numbers (mulberry32). Deterministic for the same seed on every machine.

export function hashString(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = (Number.isFinite(seed) ? seed : hashString(seed)) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    /** Float in [lo, hi). */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** Integer in [lo, hi] inclusive. */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    },
    /** A child generator, so one subsystem's draws never shift another's. */
    fork: (label) => makeRng((a ^ hashString(label)) >>> 0),
    get state() {
      return a;
    },
    set state(v) {
      a = v >>> 0;
    },
  };
  return rng;
}
