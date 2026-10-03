// Shades: the ink that walks in from the dark. Types, hues, colour rules, and the steering step.

import { CELL, WALL, ROPE, VOID, cellKind, flowAt } from './boards.js';
import { clamp, finite, lerp } from './geom.js';
import { WIDE_HOLD } from './pieces.js';

// cls: 'plain' burns under any light; 'tinted' prefers its hue; 'locked' barely burns under anything else.
export const SHADES = {
  wisp: { id: 'wisp', name: 'Wisp', hp: 20, speed: 85, radius: 11, dmg: 5, cls: 'plain', flee: 1.8, score: 10, cost: 6, night: 1, note: 'Fast, frail, afraid of light. Any beam will do.' },
  creeper: { id: 'creeper', name: 'Creeper', hp: 80, speed: 38, radius: 16, dmg: 12, cls: 'tinted', flee: 0.6, score: 20, cost: 14, night: 1, note: 'Slow and thick. Its own colour cuts it twice as well.' },
  veil: { id: 'veil', name: 'Veil', hp: 60, speed: 55, radius: 14, dmg: 10, cls: 'locked', flee: 0.8, score: 30, cost: 16, night: 2, note: 'Wants one colour. White only tickles it. Split or filter.' },
  gnat: { id: 'gnat', name: 'Gnat', hp: 6, speed: 95, radius: 6, dmg: 1, cls: 'plain', flee: 0.9, score: 2, cost: 1.2, night: 2, swarm: 12, note: 'A swarm. Wide light shreds them; a point wastes itself.' },
  eater: { id: 'eater', name: 'Eater', hp: 50, speed: 60, radius: 14, dmg: 8, cls: 'plain', flee: 0.5, score: 30, cost: 18, night: 3, chew: 5, note: 'Stops at glass and chews. Burn it before the mirror goes.' },
  burrower: { id: 'burrower', name: 'Burrower', hp: 45, speed: 50, radius: 13, dmg: 8, cls: 'tinted', flee: 0.7, score: 30, cost: 15, night: 3, inside: true, note: 'Comes up through the felt, inside your lines.' },
  gloom: { id: 'gloom', name: 'Gloom', hp: 90, speed: 34, radius: 20, dmg: 15, cls: 'tinted', flee: 0.3, score: 50, cost: 30, night: 5, aura: 96, note: 'Carries its own dark: beams through it lose most of their light.' },
  twain: { id: 'twain', name: 'Twain', hp: 70, speed: 48, radius: 15, dmg: 10, cls: 'tinted', flee: 0.7, score: 35, cost: 22, night: 5, splits: 'half', note: 'Dies into two. Finish both.' },
  half: { id: 'half', name: 'Half-Twain', hp: 25, speed: 66, radius: 10, dmg: 5, cls: 'tinted', flee: 0.9, score: 8, cost: 4, night: 99, note: 'What a Twain leaves behind.' },
  mimic: { id: 'mimic', name: 'Mimic', hp: 70, speed: 45, radius: 15, dmg: 10, cls: 'plain', flee: 0.4, score: 40, cost: 28, night: 6, mirror: true, note: 'Glass-skinned. Throws your light back. A focused beam from behind kills it.' },
  moth: { id: 'moth', name: 'Moth', hp: 40, speed: 70, radius: 12, dmg: 4, cls: 'plain', flee: 0, score: 25, cost: 20, night: 7, seeks: true, hardened: true, note: 'Flies up the brightest beam to its source and smothers the Lamp.' },
  umbra: { id: 'umbra', name: 'Umbra', hp: 600, speed: 22, radius: 40, dmg: 40, cls: 'locked', flee: 0, score: 500, cost: 0, night: 4, boss: true, hardened: true, note: 'Casts shadows that swallow beams. Three colours, in turn.' },
  lenseater: { id: 'lenseater', name: 'The Lens-Eater', hp: 900, speed: 30, radius: 44, dmg: 40, cls: 'plain', flee: 0, score: 800, cost: 0, night: 8, boss: true, hardened: true, eye: true, chew: 3, note: 'Eats glass. Only the open eye burns.' },
  longdusk: { id: 'longdusk', name: 'The Long Dusk', hp: 880, speed: 0, radius: 52, dmg: 0, cls: 'locked', flee: 0, score: 1500, cost: 0, night: 12, boss: true, hardened: true, sits: true, note: 'Does not come to you. Darkens the table in waves. Burn it where it sits.' },
};

export const SHADE_IDS = Object.keys(SHADES);
export const isShadeType = (t) => typeof t === 'string' && Object.hasOwn(SHADES, t);
export const HUES = ['r', 'g', 'b'];
export const GLYPH = { r: 'triangle', g: 'square', b: 'circle', w: 'diamond' };
export const MAX_SHADES = 160;

export const K_DAMAGE = 0.2;
export const W0 = 12;

/** The colour multiplier of a beam (channel powers) against a Shade. */
export function colourMult(shade, seg, mods) {
  const cls = effectiveClass(shade);
  if (cls === 'plain') return 1;
  const r = finite(seg.r);
  const g = finite(seg.g);
  const b = finite(seg.b);
  const P = r + g + b;
  if (P <= 0) return 0;
  const hue = effectiveHue(shade);
  const s = hue === 'r' ? r / P : hue === 'g' ? g / P : hue === 'b' ? b / P : 1 / 3;
  const match = 2 + finite(mods?.matchBonus);
  if (cls === 'tinted') return s >= 1 / 3 ? lerp(0.75, match, (s - 1 / 3) / (2 / 3)) : lerp(0.35, 0.75, s / (1 / 3));
  return s >= 1 / 3 ? lerp(0.15, match, (s - 1 / 3) / (2 / 3)) : lerp(0.05, 0.15, s / (1 / 3));
}

export function effectiveClass(shade) {
  const def = SHADES[shade.type];
  if (!def) return 'plain';
  if (shade.type === 'umbra' || shade.type === 'longdusk') return 'locked';
  return def.cls;
}

/** The hue a Shade shows and burns under right now (bosses cycle theirs). */
export function effectiveHue(shade) {
  if (shade.type === 'umbra') return HUES[clamp(finite(shade.phase), 0, 2)];
  if (shade.type === 'longdusk') return HUES[clamp(finite(shade.phase), 0, 2)];
  return shade.hue === 'r' || shade.hue === 'g' || shade.hue === 'b' ? shade.hue : 'w';
}

/** A fresh Shade. `x, y` in reference px; `hue` 'r'|'g'|'b'|'w'. */
export function makeShade(id, type, hue, x, y, t, hpMult = 1) {
  const def = SHADES[type] || SHADES.wisp;
  const hp = Math.round(def.hp * clamp(finite(hpMult, 1), 0.1, 50));
  return {
    id,
    type: def.id,
    hue: def.cls === 'plain' ? 'w' : hue === 'r' || hue === 'g' || hue === 'b' ? hue : 'r',
    x: finite(x),
    y: finite(y),
    hx: 1,
    hy: 0,
    vx: 0,
    vy: 0,
    hp,
    maxHp: hp,
    r: def.radius,
    born: finite(t),
    state: 'walk',
    target: 0,
    chew: 0,
    lit: 0, // brightness it stands in (for drawing)
    burn: 0, // recent damage (for drawing)
    firstHit: -1,
    lastHit: null, // { hue, focused }
    phase: 0,
    eye: 0,
    timer: 0,
    seed: (id * 7919) % 1000,
  };
}

/** Clamp a Shade to the table plus a margin of dark so nothing walks off into the void forever. */
export function clampToWorld(s, board) {
  const m = CELL * 2;
  s.x = clamp(finite(s.x, board.cx), -m, board.w + m);
  s.y = clamp(finite(s.y, board.cy), -m, board.h + m);
}

const blocked = (board, x, y) => {
  const k = cellKind(board, Math.floor(x / CELL), Math.floor(y / CELL));
  return k === WALL || k === ROPE;
};

/** Nearest brightest segment for a Moth: it flies toward the source end of the strongest beam near it. */
function mothSeek(s, segments, out) {
  let best = null;
  let bestScore = -Infinity;
  for (const seg of segments) {
    const P = seg.r + seg.g + seg.b;
    const d = Math.hypot(seg.x0 - s.x, seg.y0 - s.y) + Math.hypot(seg.x1 - s.x, seg.y1 - s.y);
    const score = P - d * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = seg;
    }
  }
  if (!best) return false;
  // Head for the start of the segment (where the light came from), via its line.
  const dx = best.x0 - s.x;
  const dy = best.y0 - s.y;
  const l = Math.hypot(dx, dy) || 1;
  out.x = dx / l;
  out.y = dy / l;
  return true;
}

const tmpFlow = { x: 0, y: 0 };
const tmpSeek = { x: 0, y: 0 };

/**
 * Moves every living Shade one tick. `light` gives brightness and gradient at a point; `pieceAt` finds a piece near
 * a point for Eaters. Returns the list of Heart hits { shade, heart } this tick. Pure given its inputs.
 */
export function stepShades(shades, board, dt, ctx) {
  const { light, mods, segments, pieceNear, buckets } = ctx;
  const hits = [];
  const slowShare = clamp(finite(mods.lightSlow, 0.5), 0, 0.9);
  for (const s of shades) {
    if (s.state === 'dead' || s.state === 'hit') continue;
    const def = SHADES[s.type] || SHADES.wisp;
    s.timer += dt;
    const lit = light ? light.sample(s.x, s.y) : 0;
    s.lit = lit;
    if (def.sits) continue;
    if (s.state === 'chew') {
      s.chew += dt;
      continue;
    }
    // Where to go: the flow field, pushed away from bright pools (unless hardened), spaced from neighbours.
    let dxs;
    let dys;
    if (def.seeks && segments && segments.length && mothSeek(s, segments, tmpSeek)) {
      dxs = tmpSeek.x;
      dys = tmpSeek.y;
    } else {
      flowAt(board, s.x, s.y, tmpFlow);
      dxs = tmpFlow.x;
      dys = tmpFlow.y;
      if (light && def.flee > 0) {
        // Light pushes, gently: ink hesitates and bends around a pool rather than finding a way round every beam.
        const g = light.gradient(s.x, s.y);
        dxs -= g.x * def.flee * 0.35;
        dys -= g.y * def.flee * 0.35;
      }
    }
    if (buckets) {
      const near = buckets.near(s.x, s.y);
      for (const o of near) {
        if (o === s || o.state === 'dead' || o.state === 'hit') continue;
        const ox = s.x - o.x;
        const oy = s.y - o.y;
        const d = Math.hypot(ox, oy);
        const want = s.r + o.r + 4;
        if (d < want && d > 0.01) {
          const push = ((want - d) / want) * 0.9;
          dxs += (ox / d) * push;
          dys += (oy / d) * push;
        }
      }
    }
    const l = Math.hypot(dxs, dys) || 1;
    dxs /= l;
    dys /= l;
    let speed = def.speed * finite(s.speedMult, 1);
    if (!def.hardened && !s.hardened) {
      speed *= 1 - slowShare * clamp(lit / 0.6, 0, 1);
      // Spread light is a fence: ink wades through it.
      if (light && light.holdAt) speed *= 1 - WIDE_HOLD * light.holdAt(s.x, s.y);
    }
    if (s.scared > 0) {
      s.scared -= dt;
      speed *= 0.35;
    }
    // Smooth turning so the ink flows rather than jitters.
    const turn = clamp(dt * 6, 0, 1);
    s.vx = lerp(s.vx, dxs * speed, turn);
    s.vy = lerp(s.vy, dys * speed, turn);
    const nx = s.x + s.vx * dt;
    const ny = s.y + s.vy * dt;
    if (!blocked(board, nx, s.y)) s.x = nx;
    else s.vx = 0;
    if (!blocked(board, s.x, ny)) s.y = ny;
    else s.vy = 0;
    clampToWorld(s, board);
    const vl = Math.hypot(s.vx, s.vy);
    if (vl > 1) {
      s.hx = s.vx / vl;
      s.hy = s.vy / vl;
    }
    // Eaters stop at the first glass they can reach.
    if (def.chew && pieceNear && s.state === 'walk') {
      const p = pieceNear(s.x, s.y, CELL * 0.95);
      if (p) {
        s.state = 'chew';
        s.target = p.id;
        s.chew = 0;
        continue;
      }
    }
    for (let i = 0; i < board.hearts.length; i++) {
      const h = board.hearts[i];
      if (Math.hypot(h.x - s.x, h.y - s.y) <= h.radius + s.r * 0.6) {
        s.state = 'hit';
        hits.push({ shade: s, heart: i });
        break;
      }
    }
  }
  return hits;
}

/** Cell buckets for cheap neighbour lookups; rebuilt each tick. */
export function makeBuckets(board, shades) {
  const cols = board.cols + 4;
  const rows = board.rows + 4;
  const map = new Map();
  const key = (x, y) => {
    const c = clamp(Math.floor(x / CELL) + 2, 0, cols - 1);
    const r = clamp(Math.floor(y / CELL) + 2, 0, rows - 1);
    return r * cols + c;
  };
  for (const s of shades) {
    if (s.state === 'dead' || s.state === 'hit') continue;
    const k = key(s.x, s.y);
    let a = map.get(k);
    if (!a) {
      a = [];
      map.set(k, a);
    }
    a.push(s);
  }
  const out = [];
  return {
    near(x, y) {
      out.length = 0;
      const c = clamp(Math.floor(x / CELL) + 2, 0, cols - 1);
      const r = clamp(Math.floor(y / CELL) + 2, 0, rows - 1);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const a = map.get((r + dr) * cols + (c + dc));
          if (a) for (const s of a) out.push(s);
        }
      }
      return out;
    },
  };
}

/** Walkable spawn spot for a Burrower: a random open cell at least `minCells` from every Heart. */
export function burrowSpot(board, rng, minCells = 4) {
  for (let i = 0; i < 200; i++) {
    const c = rng.int(0, board.cols - 1);
    const r = rng.int(0, board.rows - 1);
    const k = cellKind(board, c, r);
    if (k !== 1) continue;
    const x = (c + 0.5) * CELL;
    const y = (r + 0.5) * CELL;
    let ok = true;
    for (const h of board.hearts) if (Math.hypot(h.x - x, h.y - y) < minCells * CELL) ok = false;
    if (ok) return { x, y };
  }
  return { x: board.cx + CELL * 5, y: board.cy };
}

export { VOID };
