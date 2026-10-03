// The table at rest: a finished machine running a slow, endless night behind the title and the Observatory. The
// real simulation (so the light, the burning and the ink are the game's own; the light burns hotter, so every Shade
// that walks in is seen to burn), a few Shades at a time, the Heart kept whole, nothing that touches a run or a room.

import { buildBoard, CELL } from '../sim/boards.js';
import { createNight, TICK } from '../sim/night.js';
import { makeRng } from '../sim/rng.js';
import { makeShade } from '../sim/shades.js';

const DECK = { mirror: 6, splitter: 2, prism: 1, lens: 2 };
// The Lamp splits at once: one half drops to a prism that fans colour to the east, the other climbs and runs the
// north through a lens, then turns down the east side. Built for the Octagon.
const MACHINE = [
  ['splitter', 4, 6, 45],
  ['mirror', 4, 9, 45],
  ['prism', 9, 9, 100],
  ['mirror', 7, 6, 135],
  ['mirror', 7, 3, 135],
  ['lens', 11, 3, 90],
  ['mirror', 16, 3, 45],
];
const KINDS = [
  ['wisp', 'w'],
  ['wisp', 'w'],
  ['creeper', 'r'],
  ['creeper', 'g'],
  ['veil', 'b'],
  ['gnat', 'r'],
];

export function makeDemo() {
  const board = buildBoard('octagon');
  const N = createNight({ seed: 11, night: 3, board, deck: DECK, players: [{ id: 'demo' }], heart: { hp: 100, max: 100 }, mods: { breathLow: 1.05, breathHigh: 1.2, lightSlow: 0.6, damage: 4 } });
  for (const [type, c, r, angle] of MACHINE) N.command('demo', { op: 'place', type, c, r, angle });
  // Hold the night in an endless pause between waves: the ink comes only from here.
  N.S.phase = 'break';
  N.S.breakUntil = 1e9;
  const rng = makeRng(29);
  let nextAt = 1.5;
  let acc = 0;
  const arcs = [1, 2, 3]; // the north-east, east and south-east: where the machine's light lies

  function spawn() {
    const [type, hue] = rng.pick(KINDS);
    const ai = rng.pick(arcs);
    const arc = board.arcs[ai];
    const n = type === 'gnat' ? 5 : 1;
    for (let k = 0; k < n && N.S.shades.length < 24; k++) {
      // Out in the dark past the arc, so each one is seen walking in before the light finds it.
      const u = rng.next();
      const out = CELL * 1.4 + k * 14;
      const s = makeShade(N.S.nextShadeId++, type, hue, arc.x0 + (arc.x1 - arc.x0) * u + arc.ux * out, arc.y0 + (arc.y1 - arc.y0) * u + arc.uy * out, N.S.t, 1);
      s.hx = -arc.ux;
      s.hy = -arc.uy;
      s.arc = ai;
      N.S.shades.push(s);
    }
  }

  return {
    board,
    N,
    /** Advances the demo by `dt` real seconds at `speed` (a slow, calm night). */
    step(dt, speed = 0.7) {
      acc += Math.min(0.1, Math.max(0, dt)) * speed;
      let n = 0;
      while (acc >= TICK && n < 4) {
        acc -= TICK;
        n++;
        N.tick();
        N.S.heart.hp = N.S.heart.max;
        N.drainEvents();
        if (N.S.t >= nextAt) {
          nextAt = N.S.t + 2.2 + rng.next() * 2.2;
          spawn();
        }
        for (const p of N.S.pieces) p.heat = Math.min(p.heat, 60);
      }
    },
    /** What the scene draws. */
    view(intensity = 1) {
      const S = N.S;
      return { t: S.t, pieces: S.pieces, lamps: S.lamps, shades: S.shades, segments: S.trace ? S.trace.segments : [], heart: S.heart, dawn: { charge: 18, max: 40, active: false }, phase: 'wave', upcoming: [], shadows: [], bands: [], mods: N.mods, intensity };
    },
  };
}

export { CELL };
