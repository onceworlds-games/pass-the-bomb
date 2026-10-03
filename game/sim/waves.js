// Night plans: which Shades come, from where, in what colour, and when. Seeded, so every page in a room and
// every run of the harness agrees on the same night. The generator never makes an unwinnable night: the budget
// grows smoothly, only unlocked types appear, and every entry lands on a real arc.

import { makeRng, hashString } from './rng.js';
import { SHADES, HUES } from './shades.js';

export const BOSS_NIGHTS = { 4: 'umbra', 8: 'lenseater', 12: 'longdusk' };
export const RUN_NIGHTS = 12;

export function waveCount(night) {
  return night <= 2 ? 3 : night <= 5 ? 4 : night <= 8 ? 5 : 6;
}

export function nightBudget(night, ascension = 0) {
  // Steep through night 8, then gentler: the late nights thicken bodies and mix colours instead of piling on.
  return 100 * Math.pow(1.17, Math.min(night, 8) - 1) * Math.pow(1.045, Math.max(0, night - 8)) * (1 + 0.08 * ascension);
}

export function waveDuration(night) {
  return 40 + Math.min(30, night * 2.5);
}

/** Shade hp multiplier for a night (counts grow with the budget; bodies thicken slowly too). */
export function nightHp(night, ascension = 0) {
  return (1 + 0.04 * Math.max(0, night - 3)) * (1 + 0.1 * Math.min(ascension, 1)) * (night > RUN_NIGHTS ? 1 + 0.12 * (night - RUN_NIGHTS) : 1);
}

/** Boss for a night: the three of the run, then a cycle through Endless with thicker bodies. */
export function bossFor(night) {
  if (BOSS_NIGHTS[night]) return { type: BOSS_NIGHTS[night], hpMult: 1 };
  if (night > RUN_NIGHTS && (night - RUN_NIGHTS) % 4 === 0) {
    const k = (night - RUN_NIGHTS) / 4;
    const types = ['umbra', 'lenseater', 'longdusk'];
    return { type: types[(k - 1) % 3], hpMult: 1 + 0.3 * k };
  }
  return null;
}

const TYPE_WEIGHT = {
  wisp: (n) => Math.max(0.5, 3 - n * 0.25),
  creeper: (n) => 1.2 + Math.min(1, n * 0.1),
  veil: (n) => (n >= 2 ? 0.8 + n * 0.08 : 0),
  gnat: (n) => (n >= 2 ? 0.9 : 0),
  eater: (n) => (n >= 3 ? 0.7 : 0),
  burrower: (n) => (n >= 3 ? 0.6 : 0),
  gloom: (n) => (n >= 5 ? 0.6 : 0),
  twain: (n) => (n >= 5 ? 0.7 : 0),
  mimic: (n) => (n >= 6 ? 0.6 : 0),
  moth: (n) => (n >= 7 ? 0.5 : 0),
};

/** The Shade types a night can draw from (the almanac's unlock order), with weights. */
export function pool(night, ascension = 0) {
  const out = [];
  for (const id of Object.keys(TYPE_WEIGHT)) {
    let w = TYPE_WEIGHT[id](night);
    if (ascension >= 6 && id === 'eater') w = Math.max(w, 0.7);
    if (ascension >= 4 && id === 'veil') w *= 1.6;
    if (w > 0) out.push({ id, w });
  }
  return out;
}

function pickWeighted(rng, items) {
  let total = 0;
  for (const it of items) total += it.w;
  let x = rng.next() * total;
  for (const it of items) {
    x -= it.w;
    if (x <= 0) return it.id;
  }
  return items[items.length - 1].id;
}

/**
 * The plan for a night. `seed` is the run seed; the night number and board id fold into it.
 * Returns { night, waves: [{ i, dur, entries, hues, arcs, budget }], boss, hpMult }.
 * entries: [{ t, type, hue, arc, n, gap }] sorted by t (seconds from the wave's start).
 */
export function planNight({ seed, night, board, ascension = 0, tutorial = false }) {
  const rng = makeRng((hashString(`${seed}:${night}:${board.id}`) ^ 0x9e3779b9) >>> 0);
  const arcsN = board.arcs.length;
  const hpMult = nightHp(night, ascension);
  if (tutorial && night === 1) return tutorialNight(board, hpMult);
  const W = waveCount(night);
  const total = nightBudget(night, ascension);
  const shares = [];
  let sum = 0;
  for (let i = 0; i < W; i++) {
    shares.push(1 + 0.35 * i);
    sum += 1 + 0.35 * i;
  }
  const boss = bossFor(night);
  const waves = [];
  const types = pool(night, ascension);
  for (let i = 0; i < W; i++) {
    // The boss is most of its wave: its escorts are a light wave, not a full one.
    const budget = ((total * shares[i]) / sum) * (boss && i === W - 1 ? 0.5 : 1);
    const dur = waveDuration(night);
    const hueCount = night >= 4 ? rng.int(1, 2) : 1;
    const hues = rng.shuffle([...HUES]).slice(0, hueCount);
    const arcCount = Math.min(arcsN, night <= 1 ? 1 : night <= 4 ? 2 : 3);
    const arcs = rng.shuffle([...Array(arcsN).keys()]).slice(0, arcCount);
    const entries = [];
    let left = budget;
    let guard = 0;
    let count = 0;
    while (left > 2 && guard++ < 60 && count < 70) {
      const type = pickWeighted(rng, types);
      const def = SHADES[type];
      let n = def.swarm || rng.int(2, Math.min(5, 2 + Math.floor(night / 2)));
      // Heavy ink comes in twos and threes, never a wall of it.
      if (!def.swarm) n = Math.min(n, def.cost >= 25 ? 2 : def.cost >= 15 ? 3 : n);
      const cost = def.cost * n;
      if (cost > left * 1.35 && !def.swarm) {
        n = Math.max(1, Math.floor(left / def.cost));
        if (n < 1) continue;
      }
      if (n < 1) continue;
      entries.push({ t: rng.range(1.5, dur * 0.72), type, hue: rng.pick(hues), arc: rng.pick(arcs), n, gap: def.swarm ? 0.35 : rng.range(0.8, 1.6) });
      left -= def.cost * n;
      count += n;
    }
    if (!entries.length) entries.push({ t: 2, type: 'wisp', hue: hues[0], arc: arcs[0], n: 3, gap: 1 });
    entries.sort((a, b) => a.t - b.t);
    // The last wave of a boss night carries the boss, escorted.
    if (boss && i === W - 1) {
      entries.unshift({ t: 4, type: boss.type, hue: hues[0], arc: arcs[0], n: 1, gap: 0, hpMult: boss.hpMult });
    }
    waves.push({ i, dur, entries, hues, arcs, budget: Math.round(budget) });
  }
  return { night, waves, boss: boss ? boss.type : null, hpMult };
}

/**
 * Night 1 of a first run: it teaches, one idea a wave. First the ink walks in along the Lamp's own beam (the west
 * lane) and burns with nothing placed: light on a lane burns. Then it comes from the north and the south, where
 * glass must bend the light. Then thick red Creepers from the east and north: colour, and Focus at night.
 */
function tutorialNight(board, hpMult) {
  const arcIndex = (id, fallback) => {
    const i = board.arcs.findIndex((a) => a.id === id);
    return i >= 0 ? i : fallback;
  };
  const W = arcIndex('W', 0);
  const E = arcIndex('E', 0);
  const N = arcIndex('N', 1 % board.arcs.length);
  const S = arcIndex('S', 2 % board.arcs.length);
  return {
    night: 1,
    hpMult,
    boss: null,
    tutorial: true,
    waves: [
      { i: 0, dur: 30, hues: ['r'], arcs: [W], budget: 24, entries: [{ t: 2, type: 'wisp', hue: 'r', arc: W, n: 4, gap: 1.8 }] },
      { i: 1, dur: 36, hues: ['r'], arcs: [N, S], budget: 36, entries: [{ t: 3, type: 'wisp', hue: 'r', arc: N, n: 3, gap: 1.6 }, { t: 11, type: 'wisp', hue: 'r', arc: S, n: 3, gap: 1.6 }] },
      { i: 2, dur: 40, hues: ['r'], arcs: [E, N], budget: 50, entries: [{ t: 2, type: 'creeper', hue: 'r', arc: E, n: 2, gap: 2.5 }, { t: 9, type: 'wisp', hue: 'r', arc: N, n: 4, gap: 1.2 }, { t: 18, type: 'creeper', hue: 'r', arc: N, n: 1, gap: 1 }] },
    ],
  };
}

/** Expands a wave's entries into individual spawns { t, type, hue, arc, hpMult } sorted by time. */
export function expandWave(wave) {
  const out = [];
  for (const e of wave.entries) {
    for (let k = 0; k < e.n; k++) out.push({ t: e.t + k * e.gap, type: e.type, hue: e.hue, arc: e.arc, hpMult: e.hpMult || 1 });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** What the forecast at dusk says: hues and arcs of the first wave (or every wave with Second Sight / a Seer). */
export function forecast(plan, all = false) {
  const waves = all ? plan.waves : plan.waves.slice(0, 1);
  const hues = new Set();
  const arcs = new Set();
  const types = new Set();
  for (const w of waves) {
    for (const h of w.hues) hues.add(h);
    for (const a of w.arcs) arcs.add(a);
    for (const e of w.entries) types.add(e.type);
  }
  return { hues: [...hues], arcs: [...arcs], types: [...types], waves: plan.waves.length, boss: plan.boss };
}
