// Bots for the balance harness: three skills that place glass with random search, hill-climbing and colour-aware
// search over the same pure simulation a player drives. They only ever use the night's public commands.

import { CELL, OPEN, cellKind, flowAt, cellCentre } from './boards.js';
import { traceBeams } from './trace.js';
import { colourMult, SHADES, W0, K_DAMAGE } from './shades.js';
import { oriented, PIECES } from './pieces.js';
import { pointSegment, snapDeg, normDeg } from './geom.js';
import { HEAT_RATE, COOL_RATE } from './night.js';
import { HALO, HALO_SHARE } from './light.js';
import { forecast } from './waves.js';

const PIECE_PRIORITY = { prism: 5, lens: 4, 'filter-r': 3.5, 'filter-g': 3.5, 'filter-b': 3.5, mirror: 3, splitter: 2.5, combiner: 2, rotor: 2, concave: 1, heatsink: 1, crystal: 2, shutter: 0, black: 0 };
const HILL_PRIORITY = { mirror: 4, lens: 4, splitter: 3, prism: 2, rotor: 2, 'filter-r': 1, 'filter-g': 1, 'filter-b': 1, combiner: 1, concave: 1, heatsink: 1, crystal: 1.5, shutter: 0, black: 0 };
const RELIC_PRIORITY = ['lamp-oil', 'widows-lamp', 'polished-brass', 'tinted-monocle', 'cold-hands', 'dichroic-glass', 'jewellers-loupe', 'thick-felt', 'lantern-ring', 'night-eyes', 'salt-line', 'quicksilver', 'star-chart', 'half-silver', 'anvil', 'ember-heart', 'deep-well', 'long-breath', 'ash-ward', 'moth-eaten-velvet', 'second-sight', 'firebrand', 'clockwork-key', 'black-ledger'];
const UPGRADE_PRIORITY = ['quartz', 'cold-glass', 'bright-prism', 'clear-filters', 'long-lens', 'short-lens'];

/** Open cells of a board that no piece stands on (candidate spots). */
function freeCells(N, except) {
  const out = [];
  for (let r = 0; r < N.board.rows; r++) {
    for (let c = 0; c < N.board.cols; c++) {
      if (cellKind(N.board, c, r) !== OPEN) continue;
      if (N.S.pieces.some((p) => p.c === c && p.r === r && p.id !== except)) continue;
      out.push({ c, r });
    }
  }
  return out;
}

/**
 * Scores a layout: how much burning a Shade meets walking each entry arc's path to the Heart, in the colours of
 * the forecast, minus a penalty for glass that would run hot. Higher is better. Pure and fast (one trace).
 */
export function evaluateLayout(N, pieces, lampAngles, hues, arcs, opts = {}) {
  const board = N.board;
  const mods = N.mods;
  const lamps = N.S.lamps.map((L, i) => ({ x: L.x, y: L.y, angle: lampAngles[i] ?? L.angle, power: L.base * mods.lampPower, radius: L.radius }));
  const trace = traceBeams({ board, pieces, lamps, t: N.S.t, mods });
  const segs = trace.segments;
  const probes = [];
  // A probe is a Shade walking in from an arc: a Creeper of each expected hue (and a Veil when Veils are due).
  for (const h of hues.length ? hues : ['r', 'g', 'b']) probes.push({ type: 'creeper', hue: h, w: 1, hp: 80, speed: 38 });
  if (opts.locked) for (const h of hues) probes.push({ type: 'veil', hue: h, w: 0.8, hp: 60, speed: 55 });
  probes.push({ type: 'wisp', hue: 'w', w: 0.6, hp: 20, speed: 85 });
  const useArcs = arcs.length ? arcs : board.arcs.map((_, i) => i);
  const dir = { x: 0, y: 0 };
  const STEP = 20;
  let score = 0;
  for (const ai of useArcs) {
    const arc = board.arcs[ai];
    if (!arc) continue;
    for (const pr of probes) {
      let x = arc.x;
      let y = arc.y;
      let burned = 0;
      for (let step = 0; step < 90 && burned < pr.hp; step++) {
        let near = false;
        for (const h of board.hearts) if (Math.hypot(h.x - x, h.y - y) < h.radius + 6) near = true;
        if (near) break;
        let dps = 0;
        let lit = 0;
        for (const seg of segs) {
          const P = seg.r + seg.g + seg.b;
          const q = pointSegment(x, y, seg.x0, seg.y0, seg.x1, seg.y1);
          const w = seg.w0 + (seg.w1 - seg.w0) * q.u;
          const inner = w * 0.5 + 12;
          if (q.d > inner + HALO) continue;
          const halo = q.d > inner ? HALO_SHARE * (1 - (q.d - inner) / HALO) : 1;
          dps += halo * K_DAMAGE * P * colourMult(pr, seg, mods) * (W0 / Math.max(1, w));
          if (halo === 1) lit += P / 100;
        }
        const speed = pr.speed * (1 - mods.lightSlow * Math.min(1, lit / 0.6));
        burned += (dps * STEP) / Math.max(8, speed);
        flowAt(board, x, y, dir);
        x += dir.x * STEP;
        y += dir.y * STEP;
      }
      // A probe burned to death scores its hp; one that arrives scores what it lost (quadratic: nearly dead counts).
      const share = Math.min(1, burned / pr.hp);
      score += pr.w * pr.hp * (share >= 1 ? 1.25 : share * share);
    }
  }
  // Stationary targets (a boss that sits, a boss that chews): what a beam does to it over the next while.
  for (const tg of opts.targets || []) {
    let dps = 0;
    for (const seg of segs) {
      const P = seg.r + seg.g + seg.b;
      const q = pointSegment(tg.x, tg.y, seg.x0, seg.y0, seg.x1, seg.y1);
      const w = seg.w0 + (seg.w1 - seg.w0) * q.u;
      const inner = w * 0.5 + tg.r;
      if (q.d > inner + HALO) continue;
      const halo = q.d > inner ? HALO_SHARE * (1 - (q.d - inner) / HALO) : 1;
      dps += halo * K_DAMAGE * P * colourMult(tg, seg, mods) * (W0 / Math.max(1, w));
    }
    score += Math.min(tg.hp, dps * 25) * 1.5;
  }
  // Heat: a piece whose steady heat would pass the cap is a crack waiting to happen.
  for (const p of pieces) {
    const l = trace.load.get(p.id);
    if (!l) continue;
    const absorbed = l.heat * HEAT_RATE * mods.heatRate;
    const steady = (absorbed / mods.cooling - 1) / COOL_RATE;
    if (steady > 100) score -= 40 + (steady - 100) * 0.5;
    else if (steady > 75) score -= (steady - 75) * 0.4;
  }
  return score;
}

/** Points along the current beams: where a piece can be placed to change the light. */
function beamCells(N, layout, free) {
  const lamps = N.S.lamps.map((L, i) => ({ x: L.x, y: L.y, angle: layout.lamps[i] ?? L.angle, power: 100, radius: L.radius }));
  const trace = traceBeams({ board: N.board, pieces: layout.pieces, lamps, t: N.S.t, mods: N.mods });
  const cells = [];
  const seen = new Set();
  for (const seg of trace.segments) {
    const n = Math.max(1, Math.floor(seg.len / CELL));
    for (let i = 1; i <= n; i++) {
      const c = Math.floor((seg.x0 + seg.dx * i * CELL - seg.dx * CELL * 0.5) / CELL);
      const r = Math.floor((seg.y0 + seg.dy * i * CELL - seg.dy * CELL * 0.5) / CELL);
      const k = r * 100 + c;
      if (seen.has(k)) continue;
      seen.add(k);
      if (free.some((f) => f.c === c && f.r === r)) cells.push({ c, r });
    }
  }
  return cells;
}

/** Same scoring, but against where the Shades are now and will be in the next seconds (used during a wave). */
export function evaluateLive(N, pieces, lampAngles) {
  const board = N.board;
  const mods = N.mods;
  const lamps = N.S.lamps.map((L, i) => ({ x: L.x, y: L.y, angle: lampAngles[i] ?? L.angle, power: L.base * mods.lampPower, radius: L.radius }));
  const trace = traceBeams({ board, pieces, lamps, t: N.S.t, mods, zones: { glooms: [], mimics: [], shadows: N.S.shadows, bands: N.S.bands } });
  let score = 0;
  const dir = { x: 0, y: 0 };
  for (const s of N.S.shades) {
    if (s.state === 'dead' || s.state === 'hit') continue;
    let x = s.x;
    let y = s.y;
    const def = SHADES[s.type] || SHADES.wisp;
    for (let step = 0; step < 8; step++) {
      let value = 0;
      for (const seg of trace.segments) {
        const q = pointSegment(x, y, seg.x0, seg.y0, seg.x1, seg.y1);
        const w = seg.w0 + (seg.w1 - seg.w0) * q.u;
        if (q.d > w * 0.5 + s.r) continue;
        value += (seg.r + seg.g + seg.b) * colourMult(s, seg, mods) * (W0 / Math.max(1, w));
      }
      score += Math.min(value, s.hp * 6) * (step === 0 ? 2 : 1) * (def.boss ? 1.5 : 1);
      flowAt(board, x, y, dir);
      x += dir.x * def.speed * 0.5;
      y += dir.y * def.speed * 0.5;
    }
  }
  return score;
}

function cloneLayout(N) {
  return { pieces: N.S.pieces.map((p) => ({ id: p.id, type: p.type, c: p.c, r: p.r, angle: p.angle, t0: p.t0 })), lamps: N.S.lamps.map((L) => L.target) };
}

/** The cells a Shade from an arc walks through, arc first. */
function laneCells(N, arcIndex) {
  const arc = N.board.arcs[arcIndex];
  const out = [];
  if (!arc) return out;
  let x = arc.x;
  let y = arc.y;
  const dir = { x: 0, y: 0 };
  const seen = new Set();
  for (let s = 0; s < 90; s++) {
    let near = false;
    for (const h of N.board.hearts) if (Math.hypot(h.x - x, h.y - y) < h.radius + 20) near = true;
    if (near) break;
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    const k = r * 100 + c;
    if (!seen.has(k)) {
      seen.add(k);
      if (cellKind(N.board, c, r) === OPEN) out.push({ c, r });
    }
    flowAt(N.board, x, y, dir);
    x += dir.x * 16;
    y += dir.y * 16;
  }
  return out;
}

/** The plate angle that reflects direction d into direction o (null when no turn is needed). */
export function mirrorAngleFor(dx, dy, ox, oy) {
  if (dx * ox + dy * oy > 0.999) return null;
  const nx = ox - dx;
  const ny = oy - dy;
  return snapDeg((Math.atan2(ny, nx) * 180) / Math.PI + 90, 5);
}

/**
 * The move a player makes on purpose: put a mirror where a beam already is and turn it down a lane, or put one
 * on the beam in line with a lane cell so the next move can finish the chain.
 */
export function routeMutation(N, L, rng, free, arcs, hues = []) {
  const lamps = N.S.lamps.map((Lp, i) => ({ x: Lp.x, y: Lp.y, angle: L.lamps[i] ?? Lp.angle, power: 100, radius: Lp.radius }));
  const trace = traceBeams({ board: N.board, pieces: L.pieces, lamps, t: N.S.t, mods: N.mods });
  const lit = new Map();
  for (const seg of trace.segments) {
    const n = Math.max(1, Math.ceil(seg.len / (CELL * 0.5)));
    for (let i = 0; i <= n; i++) {
      const d = (seg.len * i) / n;
      const c = Math.floor((seg.x0 + seg.dx * d) / CELL);
      const r = Math.floor((seg.y0 + seg.dy * d) / CELL);
      const k = r * 100 + c;
      if (!lit.has(k) && cellKind(N.board, c, r) === OPEN) lit.set(k, { c, r, dx: seg.dx, dy: seg.dy });
    }
  }
  const mirrors = rng.shuffle(L.pieces.filter((p) => p.type === 'mirror' || p.type === 'rotor' || p.type === 'splitter'));
  if (!lit.size) return false;
  const arcList = arcs.length ? arcs : N.board.arcs.map((_, i) => i);
  const lane = laneCells(N, rng.pick(arcList));
  if (lane.length < 3) return false;
  const occupied = (c, r, self) => L.pieces.some((q) => !self.includes(q) && q.c === c && q.r === r);
  const dir = { x: 0, y: 0 };
  // Colour: drop a filter of a wanted hue onto a lit lane cell, so the lane's white light becomes the colour.
  if (hues && hues.length && rng.chance(0.4)) {
    const filters = L.pieces.filter((p) => p.type.startsWith('filter-') && hues.includes(p.type.slice(7)));
    const litLane = lane.filter((cell) => lit.has(cell.r * 100 + cell.c) && !occupied(cell.c, cell.r, filters));
    if (filters.length && litLane.length) {
      const f = rng.pick(filters);
      const cell = rng.pick(litLane);
      f.c = cell.c;
      f.r = cell.r;
      return true;
    }
  }
  if (!mirrors.length) return false;
  // Aim at a lane cell past the first third: the beam then runs down the lane toward the Heart.
  const T = lane[rng.int(Math.floor(lane.length / 3), lane.length - 2)];
  flowAt(N.board, (T.c + 0.5) * CELL, (T.r + 0.5) * CELL, dir);
  const put = (p, c, r, a) => {
    p.c = c;
    p.r = r;
    p.angle = a;
  };
  const here = lit.get(T.r * 100 + T.c);
  if (here && !occupied(T.c, T.r, [mirrors[0]])) {
    const a = mirrorAngleFor(here.dx, here.dy, dir.x, dir.y);
    if (a == null) return false;
    put(mirrors[0], T.c, T.r, a);
    return true;
  }
  // Two mirrors: a lit cell in T's row or column bends the beam at T, which drops it down the lane.
  if (mirrors.length >= 2) {
    let best = null;
    for (const cell of lit.values()) {
      if (cell.c !== T.c && cell.r !== T.r) continue;
      const d = Math.abs(cell.c - T.c) + Math.abs(cell.r - T.r);
      if (d === 0 || occupied(cell.c, cell.r, mirrors.slice(0, 2)) || occupied(T.c, T.r, mirrors.slice(0, 2))) continue;
      if (!best || d < best.d) best = { ...cell, d };
    }
    if (best) {
      const tx = Math.sign(T.c - best.c);
      const ty = Math.sign(T.r - best.r);
      const a1 = mirrorAngleFor(best.dx, best.dy, tx, ty);
      const a2 = mirrorAngleFor(tx, ty, dir.x, dir.y);
      if (a1 == null || a2 == null) return false;
      put(mirrors[0], best.c, best.r, a1);
      put(mirrors[1], T.c, T.r, a2);
      return true;
    }
  }
  // Three mirrors: bend at a lit cell toward a corner cell M in line with T, bend again at M, drop at T.
  if (mirrors.length >= 3) {
    const cells = rng.shuffle([...lit.values()]);
    for (const S of cells) {
      for (const M of [{ c: S.c, r: T.r }, { c: T.c, r: S.r }]) {
        if ((M.c === S.c && M.r === S.r) || (M.c === T.c && M.r === T.r)) continue;
        if (cellKind(N.board, M.c, M.r) !== OPEN) continue;
        const trio = mirrors.slice(0, 3);
        if (occupied(S.c, S.r, trio) || occupied(M.c, M.r, trio) || occupied(T.c, T.r, trio)) continue;
        const d1x = Math.sign(M.c - S.c);
        const d1y = Math.sign(M.r - S.r);
        const d2x = Math.sign(T.c - M.c);
        const d2y = Math.sign(T.r - M.r);
        const a1 = mirrorAngleFor(S.dx, S.dy, d1x, d1y);
        const a2 = mirrorAngleFor(d1x, d1y, d2x, d2y);
        const a3 = mirrorAngleFor(d2x, d2y, dir.x, dir.y);
        if (a1 == null || a2 == null || a3 == null) continue;
        put(trio[0], S.c, S.r, a1);
        put(trio[1], M.c, M.r, a2);
        put(trio[2], T.c, T.r, a3);
        return true;
      }
    }
  }
  return false;
}

function mutate(N, layout, rng, free, arcs = [], hues = []) {
  const L = { pieces: layout.pieces.map((p) => ({ ...p })), lamps: layout.lamps.slice() };
  const roll = rng.next();
  if (roll < 0.35 && L.pieces.length) {
    if (routeMutation(N, L, rng, free, arcs, hues)) return L;
  }
  if (roll < 0.12 && L.lamps.length) {
    const i = rng.int(0, L.lamps.length - 1);
    L.lamps[i] = snapDeg(L.lamps[i] + rng.pick([-30, -15, 15, 30]), 15);
  } else if (roll < 0.45 && L.pieces.length) {
    // Snap a piece onto a beam: the only way to discover reflections quickly.
    const cells = beamCells(N, L, free);
    const p = rng.pick(L.pieces);
    const spot = cells.length ? rng.pick(cells) : null;
    if (spot && !L.pieces.some((q) => q.c === spot.c && q.r === spot.r)) {
      p.c = spot.c;
      p.r = spot.r;
      if (oriented(p.type)) p.angle = snapDeg(rng.int(0, 23) * 15, 15);
    }
  } else if (roll < 0.75 && L.pieces.length) {
    const p = rng.pick(L.pieces);
    if (oriented(p.type) || p.type === 'combiner' || p.type === 'crystal') p.angle = snapDeg(p.angle + rng.pick([-45, -30, -15, 15, 30, 45, 90]), 15);
    else {
      const spot = rng.pick(free);
      if (spot && !L.pieces.some((q) => q.c === spot.c && q.r === spot.r)) {
        p.c = spot.c;
        p.r = spot.r;
      }
    }
  } else if (L.pieces.length) {
    const p = rng.pick(L.pieces);
    const spot = rng.pick(free);
    if (spot && !L.pieces.some((q) => q.c === spot.c && q.r === spot.r)) {
      p.c = spot.c;
      p.r = spot.r;
    }
  }
  return L;
}

/** Puts a layout on the table through the night's commands (dusk: free). */
function applyLayout(N, pid, layout) {
  for (const p of N.S.pieces.slice()) N.command(pid, { op: 'sell', id: p.id });
  for (const p of layout.pieces) N.command(pid, { op: 'place', type: p.type, c: p.c, r: p.r, angle: p.angle });
  layout.lamps.forEach((a, i) => N.command(pid, { op: 'lamp', i, angle: a }));
}

function randomLayout(N, rng) {
  const free = rng.shuffle(freeCells(N, -1));
  const pieces = [];
  let id = 1;
  for (const type of Object.keys(N.S.deck)) {
    for (let k = 0; k < N.available(type) && free.length; k++) {
      const spot = free.pop();
      pieces.push({ id: id++, type, c: spot.c, r: spot.r, angle: snapDeg(rng.int(0, 23) * 15, 15), t0: 0 });
    }
  }
  return { pieces, lamps: N.S.lamps.map((L) => snapDeg(L.angle, 15)) };
}

/**
 * A bot for one night. kind: 'random' | 'hill' | 'colour'. Call atDusk() once, then during(dt) each tick.
 */
export function makeBot(kind, N, pid, rng, opts = {}) {
  const iterations = opts.iterations ?? (kind === 'colour' ? 240 : 100);
  const colour = kind === 'colour';
  const fc = forecast(N.plan, colour && N.mods.forecastAll);
  const hues = colour ? fc.hues : [];
  const arcs = kind === 'random' ? [] : fc.arcs;
  const locked = colour && fc.types.includes('veil');
  let nextLive = 0;
  let nextLamp = 0;
  let plannedFor = -1;
  let nextBoss = 0;
  const pending = []; // commands waiting for Focus

  /** Re-plans the table for a wave (its arcs and hues) from the layout as it stands, as a player does at a break. */
  function replan(waveIndex, targets = []) {
    const w = N.plan.waves[waveIndex];
    if (!w) return;
    const wHues = colour ? w.hues : [];
    const wLocked = colour && w.entries.some((e) => e.type === 'veil');
    const cur = cloneLayout(N);
    const evalFn = (L) => evaluateLayout(N, L.pieces, L.lamps, wHues, w.arcs, { locked: wLocked, targets });
    const saved = iterations;
    const { layout } = search(cur, evalFn, Math.round(saved * (colour ? 0.7 : 0.45)), w.arcs, wHues);
    for (let i = 0; i < layout.pieces.length; i++) {
      const a = cur.pieces[i];
      const b = layout.pieces[i];
      if (a.c !== b.c || a.r !== b.r) pending.push({ op: 'move', id: a.id, c: b.c, r: b.r });
      if (a.angle !== b.angle) pending.push({ op: 'rotate', id: a.id, angle: b.angle });
    }
    layout.lamps.forEach((a, i) => a !== cur.lamps[i] && pending.push({ op: 'lamp', i, angle: a }));
  }

  function flushPending() {
    while (pending.length) {
      const res = N.command(pid, pending[0]);
      if (!res.ok && res.reason === 'focus') return;
      pending.shift();
    }
  }

  function search(start, evalFn, iters = iterations, useArcs = arcs, useHues = hues) {
    const free = freeCells(N, -1);
    let best = start;
    let bestScore = evalFn(best);
    for (let i = 0; i < iters; i++) {
      const cand = mutate(N, best, rng, free, useArcs, useHues);
      // Coordinate descent on the moved piece: the best of its angles, not a random one.
      const moved = cand.pieces.find((p, k) => oriented(p.type) && (p.c !== best.pieces[k].c || p.r !== best.pieces[k].r || p.angle !== best.pieces[k].angle));
      let s = evalFn(cand);
      if (moved && kind !== 'random') {
        let bestAngle = moved.angle;
        for (let a = 0; a < 360; a += 15) {
          if (a === bestAngle) continue;
          moved.angle = a;
          const v = evalFn(cand);
          if (v > s) {
            s = v;
            bestAngle = a;
          }
        }
        moved.angle = bestAngle;
      }
      if (s > bestScore || (s > bestScore * 0.97 && rng.chance(0.05))) {
        best = cand;
        bestScore = s;
      }
    }
    return { layout: best, score: bestScore };
  }

  return {
    kind,
    atDusk() {
      const start = randomLayout(N, rng);
      if (kind === 'random') return applyLayout(N, pid, start);
      const evalFn = (L) => evaluateLayout(N, L.pieces, L.lamps, hues, arcs, { locked });
      const { layout } = search(start, evalFn);
      applyLayout(N, pid, layout);
    },
    /** Live play: re-aim the Lamp, try one improving turn, use abilities. */
    during() {
      const S = N.S;
      if (kind === 'random') return;
      // At a break, read the next wave's forecast and re-route the table for it.
      if (S.phase === 'break' && plannedFor !== S.wave + 1) {
        plannedFor = S.wave + 1;
        replan(plannedFor);
      }
      // A boss on the table: every few seconds, re-route the glass to burn it where it is, in its colour.
      if (S.phase === 'wave' && S.t >= nextBoss) {
        const boss = S.shades.find((s) => (s.type === 'longdusk' || s.type === 'umbra' || s.type === 'lenseater') && s.state !== 'dead' && s.state !== 'hit');
        if (boss) {
          nextBoss = S.t + (boss.type === 'longdusk' ? 10 : 6);
          pending.length = 0;
          replan(S.wave, [{ x: boss.x, y: boss.y, r: boss.r, hp: boss.hp, type: boss.type, hue: boss.hue, phase: boss.phase }]);
        }
      }
      flushPending();
      if (S.phase !== 'wave' || pending.length) return;
      const pl = N.player(pid);
      if (S.t >= nextLamp) {
        nextLamp = S.t + 3;
        // Swing the Lamp toward whichever arc the most living ink is coming from, if the table has no pieces to lose.
        if (!S.pieces.length) {
          let bx = 0;
          let by = 0;
          for (const s of S.shades) if (s.state === 'walk') (bx += s.x - S.lamps[0].x), (by += s.y - S.lamps[0].y);
          if (bx || by) N.command(pid, { op: 'lamp', i: 0, angle: snapDeg((Math.atan2(by, bx) * 180) / Math.PI, 15) });
        }
      }
      if (S.t >= nextLive && pl && pl.focus >= 25 && S.pieces.length) {
        nextLive = S.t + (colour ? 2.5 : 4);
        // Live play is turning, not rebuilding: one rotation (or a Lamp swing) when it clearly helps right now.
        const cur = cloneLayout(N);
        const base = evaluateLive(N, cur.pieces, cur.lamps);
        let best = null;
        let bestScore = Math.max(base * 1.5, base + 40);
        const turnable = cur.pieces.filter((p) => oriented(p.type));
        for (let i = 0; i < (colour ? 16 : 10); i++) {
          const cand = { pieces: cur.pieces.map((p) => ({ ...p })), lamps: cur.lamps.slice() };
          if (turnable.length && rng.chance(0.8)) {
            const k = cur.pieces.indexOf(rng.pick(turnable));
            cand.pieces[k].angle = snapDeg(cand.pieces[k].angle + rng.pick([-45, -30, -15, 15, 30, 45]), 15);
          } else if (cand.lamps.length) {
            const li = rng.int(0, cand.lamps.length - 1);
            cand.lamps[li] = snapDeg(cand.lamps[li] + rng.pick([-30, -15, 15, 30]), 15);
          }
          const s = evaluateLive(N, cand.pieces, cand.lamps);
          if (s > bestScore) {
            bestScore = s;
            best = cand;
          }
        }
        if (best) {
          for (let i = 0; i < best.pieces.length; i++) if (cur.pieces[i].angle !== best.pieces[i].angle) N.command(pid, { op: 'rotate', id: cur.pieces[i].id, angle: best.pieces[i].angle });
          best.lamps.forEach((a, i) => a !== cur.lamps[i] && N.command(pid, { op: 'lamp', i, angle: a }));
        }
      }
      if (pl) {
        let nearHeart = 0;
        let alive = 0;
        let cx = 0;
        let cy = 0;
        for (const s of S.shades) {
          if (s.state !== 'walk' && s.state !== 'chew') continue;
          alive++;
          for (const h of N.board.hearts) {
            if (Math.hypot(h.x - s.x, h.y - s.y) < CELL * 3) {
              nearHeart++;
              cx += s.x;
              cy += s.y;
            }
          }
        }
        if (nearHeart >= 3 && S.t >= pl.flareAt) N.command(pid, { op: 'flare', x: cx / nearHeart, y: cy / nearHeart });
        if (alive >= 6 && S.dawn.charge >= S.dawn.max) N.command(pid, { op: 'dawn' });
        if (pl.focus < 10 && S.t >= pl.surgeAt && alive >= 8) N.command(pid, { op: 'surge' });
      }
    },
    /** Drafting policy at dawn: index of the option to take. */
    draft(options) {
      return pickDraft(kind, options, rng, N.S.deck);
    },
    takeFate() {
      return colour ? rng.chance(0.5) : rng.chance(0.3);
    },
  };
}

/** The option a bot of this kind takes from a dawn draft. */
export function pickDraft(kind, options, rng, deck = {}) {
  if (!options || !options.length) return 0;
  if (kind === 'random') return rng.int(0, options.length - 1);
  const colour = kind === 'colour';
  let best = 0;
  let bestV = -Infinity;
  options.forEach((o, i) => {
    let v = 0;
    if (o.kind === 'piece') {
      const have = deck[o.id] || 0;
      v = ((colour ? PIECE_PRIORITY : HILL_PRIORITY)[o.id] ?? 1) * (o.n || 1) + (colour && o.id === 'prism' && have === 0 ? 3 : 0);
      if (colour && o.id.startsWith('filter-') && have === 0) v += 2.5;
      v /= o.id === 'mirror' ? 1 + 0.1 * have : 1 + 0.6 * have;
    }
    else if (o.kind === 'relic') v = colour ? 6 - RELIC_PRIORITY.indexOf(o.id) * 0.2 : 2.5;
    else if (o.kind === 'upgrade') v = colour ? 5 - UPGRADE_PRIORITY.indexOf(o.id) * 0.4 : 2;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  });
  return best;
}

export const PIECE_NAMES = Object.fromEntries(Object.keys(PIECES).map((k) => [k, PIECES[k].name]));
export { cellCentre, normDeg };
