// The beam tracer: a pure function from (board, pieces, Lamps, time, zones) to the light on the table.
// Rays carry channel powers (r, g, b), a width model (a convex lens focuses, a concave one spreads) and a depth.
// Every interaction makes new rays; the trace ends at MAX_DEPTH, MAX_RAYS or when a ray is too weak to matter.

import { CELL, VOID, WALL, cellKind, cellCentre } from './boards.js';
import { APERTURE, DISC, BEAM_WIDTH, MIN_POWER, MAX_DEPTH, MAX_RAYS, SPREAD, PIECES, baseMods } from './pieces.js';
import { DEG, clamp, raySegment, rayCircle, rayBox, reflect, rotate, finite, normDeg } from './geom.js';

const NUDGE = 0.05;

/** The angle a piece presents at time t (rotors spin; everything else holds its angle). */
export function pieceAngle(piece, t, mods) {
  if (piece.type === 'rotor') return normDeg(finite(piece.angle) + PIECES.rotor.spin * (mods?.rotorSpeed ?? 1) * (finite(t) - finite(piece.t0)));
  return normDeg(piece.angle);
}

/** Is a shutter letting light through at time t? Its angle sets the phase, so turning it retimes it. */
export function shutterOpen(piece, t, mods) {
  const open = clamp(mods?.shutterOpen ?? 1, 0.25, 1.75);
  const phase = (normDeg(piece.angle) / 360) * 2;
  const cyc = (((finite(t) + phase) % 2) + 2) % 2;
  return cyc < open;
}

/** Width of a ray `d` px past its last lens. */
export function widthAt(ray, d) {
  if (ray.f > 0) return clamp(ray.wBase * Math.abs(1 - d / ray.f), ray.wMin, ray.wBase * 3);
  if (ray.spread > 0) return Math.min(ray.wBase * 3, ray.wBase + ray.spread * d);
  return ray.wBase;
}

/** Width of a traced segment at `dist` px from its start. */
export function segmentWidthAt(seg, dist) {
  return widthAt(seg, seg.since + dist);
}

/** The first wall or void cell along a ray (Amanatides-Woo). Returns the distance and what ended it. */
export function gridExit(board, ox, oy, dx, dy) {
  let c = Math.floor(ox / CELL);
  let r = Math.floor(oy / CELL);
  const k0 = cellKind(board, c, r);
  if (k0 === WALL || k0 === VOID) return { t: 0, kind: k0 === WALL ? 'wall' : 'rim' };
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  let tMaxX = dx !== 0 ? ((dx > 0 ? (c + 1) * CELL : c * CELL) - ox) / dx : Infinity;
  let tMaxY = dy !== 0 ? ((dy > 0 ? (r + 1) * CELL : r * CELL) - oy) / dy : Infinity;
  const tDeltaX = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? CELL / Math.abs(dy) : Infinity;
  for (let i = 0; i < board.cols + board.rows + 2; i++) {
    let t;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      c += stepX;
      tMaxX += tDeltaX;
    } else {
      t = tMaxY;
      r += stepY;
      tMaxY += tDeltaY;
    }
    const k = cellKind(board, c, r);
    if (k === WALL) return { t, kind: 'wall' };
    if (k === VOID) return { t, kind: 'rim' };
  }
  return { t: (board.cols + board.rows) * CELL, kind: 'rim' };
}

/** The aperture plate of an oriented piece at time t: endpoints and the unit normal. */
export function aperture(piece, t, mods) {
  const a = pieceAngle(piece, t, mods) * DEG;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const { x, y } = cellCentre(piece.c, piece.r);
  return { ax: x - ux * APERTURE, ay: y - uy * APERTURE, bx: x + ux * APERTURE, by: y + uy * APERTURE, nx: -uy, ny: ux, ux, uy, x, y };
}

function newRay(x, y, dx, dy, r, g, b, from) {
  return {
    x,
    y,
    dx,
    dy,
    r,
    g,
    b,
    wBase: from ? from.wBase : BEAM_WIDTH,
    wMin: from ? from.wMin : 3,
    f: from ? from.f : 0,
    spread: from ? from.spread : 0,
    since: from ? from.since : 0,
    depth: from ? from.depth + 1 : 0,
    lamp: from ? from.lamp : -1,
    ig: -1,
    glooms: from ? from.glooms : 0,
  };
}

/**
 * Traces every Lamp (and pulsing Crystal) through the pieces.
 * @param {object} args { board, pieces, lamps, t, mods, zones }
 *   lamps: [{ x, y, angle, power, radius }] with power already breathed and dimmed.
 *   zones: { shadows: [{x,y,r}], glooms: [{id,x,y,r,factor}], mimics: [{id,x,y,r,hx,hy}], bands: [{x0,x1,factor}] }
 * @returns {{ segments: Array, load: Map, heart: number[], crystalIn: Map, mimicHits: Array, lampHits: Array, rays: number, capped: boolean }}
 */
export function traceBeams({ board, pieces, lamps, t = 0, mods = baseMods(), zones = {} }) {
  const segments = [];
  const load = new Map();
  const crystalIn = new Map();
  const combinerIn = new Map();
  const heart = board.hearts.map(() => 0);
  const mimicHits = [];
  const lampHits = [];
  const shadows = zones.shadows || [];
  const glooms = zones.glooms || [];
  const mimics = zones.mimics || [];
  const bands = zones.bands || [];
  const queue = [];
  let rays = 0;
  let capped = false;

  const loadOf = (id) => {
    let l = load.get(id);
    if (!l) {
      l = { heat: 0, handled: 0, hits: 0 };
      load.set(id, l);
    }
    return l;
  };

  // Pre-compute piece geometry once per trace.
  const geo = pieces.map((p) => {
    const def = PIECES[p.type];
    if (!def || def.shape === 'none') return null;
    const { x, y } = cellCentre(p.c, p.r);
    if (def.shape === 'segment' && !p.cracked) return { p, def, seg: aperture(p, t, mods), x, y };
    return { p, def, x, y, disc: true };
  });

  for (let i = 0; i < lamps.length; i++) {
    const L = lamps[i];
    const P = finite(L.power);
    if (P < MIN_POWER) continue;
    const a = finite(L.angle) * DEG;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const rad = finite(L.radius, 22) + 1;
    const ray = newRay(finite(L.x) + dx * rad, finite(L.y) + dy * rad, dx, dy, P / 3, P / 3, P / 3, null);
    ray.lamp = i;
    queue.push(ray);
  }
  for (const g of geo) {
    if (!g || g.p.type !== 'crystal' || !(g.p.pulseUntil > t)) continue;
    const a = normDeg(g.p.angle) * DEG;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const pr = finite(g.p.pr);
    const pg = finite(g.p.pg);
    const pb = finite(g.p.pb);
    if (pr + pg + pb < MIN_POWER) continue;
    const ray = newRay(g.x + dx * (DISC + 1), g.y + dy * (DISC + 1), dx, dy, pr, pg, pb, null);
    ray.ig = g.p.id;
    queue.push(ray);
  }

  const emitSegment = (ray, tHit, end) => {
    // Split at the width model's breakpoints (the focus and twice the focus) so each piece tapers linearly.
    const s0 = ray.since;
    const s1 = s0 + tHit;
    const cuts = [];
    if (ray.f > 0) {
      for (const bp of [ray.f, ray.f * 2]) if (bp > s0 + 0.5 && bp < s1 - 0.5) cuts.push(bp);
    }
    let prev = s0;
    for (const cut of [...cuts, s1]) {
      const d0 = prev - s0;
      const d1 = cut - s0;
      segments.push({
        x0: ray.x + ray.dx * d0,
        y0: ray.y + ray.dy * d0,
        x1: ray.x + ray.dx * d1,
        y1: ray.y + ray.dy * d1,
        dx: ray.dx,
        dy: ray.dy,
        len: d1 - d0,
        r: ray.r,
        g: ray.g,
        b: ray.b,
        w0: widthAt(ray, prev),
        w1: widthAt(ray, cut),
        wBase: ray.wBase,
        wMin: ray.wMin,
        f: ray.f,
        spread: ray.spread,
        since: prev,
        depth: ray.depth,
        lamp: ray.lamp,
        end: cut === s1 ? end : 'focus',
      });
      prev = cut;
    }
  };

  const step = (ray) => {
    const P = ray.r + ray.g + ray.b;
    if (!(P >= MIN_POWER) || ray.depth > MAX_DEPTH) return;
    if (!Number.isFinite(ray.x + ray.y + ray.dx + ray.dy)) return;
    let best = gridExit(board, ray.x, ray.y, ray.dx, ray.dy);
    let bestT = best.t;
    let kind = best.kind;
    let target = null;
    const consider = (hit, k, obj) => {
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        kind = k;
        target = obj;
        best = hit;
      }
    };
    for (const g of geo) {
      if (!g || g.p.id === ray.ig) continue;
      if (g.disc) consider(rayCircle(ray.x, ray.y, ray.dx, ray.dy, g.x, g.y, DISC), 'piece', g);
      else consider(raySegment(ray.x, ray.y, ray.dx, ray.dy, g.seg.ax, g.seg.ay, g.seg.bx, g.seg.by), 'piece', g);
    }
    for (let i = 0; i < board.hearts.length; i++) {
      const h = board.hearts[i];
      consider(rayCircle(ray.x, ray.y, ray.dx, ray.dy, h.x, h.y, h.radius), 'heart', i);
    }
    for (let i = 0; i < lamps.length; i++) {
      if (ray.depth === 0 && ray.lamp === i) continue;
      const L = lamps[i];
      consider(rayCircle(ray.x, ray.y, ray.dx, ray.dy, finite(L.x), finite(L.y), finite(L.radius, 22)), 'lamp', i);
    }
    for (const z of shadows) consider(rayCircle(ray.x, ray.y, ray.dx, ray.dy, z.x, z.y, z.r), 'shadow', z);
    for (let i = 0; i < glooms.length; i++) {
      if (ray.glooms & (1 << (i & 30))) continue;
      const z = glooms[i];
      const hit = rayCircle(ray.x, ray.y, ray.dx, ray.dy, z.x, z.y, z.r);
      if (hit && !hit.inside) consider(hit, 'gloom', i);
    }
    for (const m of mimics) consider(rayCircle(ray.x, ray.y, ray.dx, ray.dy, m.x, m.y, m.r), 'mimic', m);
    for (const bnd of bands) {
      const hit = rayBox(ray.x, ray.y, ray.dx, ray.dy, bnd.x0, -1e6, bnd.x1, 1e6);
      if (hit && !hit.inside) consider(hit, 'band', bnd);
    }
    if (best.inside && kind !== 'gloom' && kind !== 'band') {
      // Started inside something solid (a Shade walked onto the beam's source): the ray is swallowed here.
      return;
    }
    if (!(bestT > 0)) return;
    emitSegment(ray, bestT, kind);
    const hx = ray.x + ray.dx * bestT;
    const hy = ray.y + ray.dy * bestT;
    const since = ray.since + bestT;
    const cont = (dx, dy, r, g, b, opts) => {
      const n = newRay(hx + dx * NUDGE, hy + dy * NUDGE, dx, dy, r, g, b, ray);
      n.since = since;
      if (opts) Object.assign(n, opts);
      queue.push(n);
      return n;
    };
    switch (kind) {
      case 'heart':
        heart[target] += P;
        return;
      case 'lamp':
        lampHits.push({ lamp: target, power: P });
        return;
      case 'shadow':
      case 'wall':
      case 'rim':
        return;
      case 'gloom': {
        const z = glooms[target];
        const f = clamp(finite(z.factor, 0.4), 0, 1);
        cont(ray.dx, ray.dy, ray.r * f, ray.g * f, ray.b * f, { depth: ray.depth, glooms: ray.glooms | (1 << (target & 30)) });
        return;
      }
      case 'band': {
        const f = clamp(finite(target.factor, 0.3), 0, 1);
        cont(ray.dx, ray.dy, ray.r * f, ray.g * f, ray.b * f, { depth: ray.depth });
        return;
      }
      case 'mimic': {
        const w = widthAt(ray, since);
        const fromBehind = ray.dx * finite(target.hx) + ray.dy * finite(target.hy) > 0.3;
        if (w < 7 && fromBehind) {
          mimicHits.push({ id: target.id, x: hx, y: hy, power: P, width: w });
          return;
        }
        const n = reflect(ray.dx, ray.dy, hx - target.x, hy - target.y);
        cont(n.x, n.y, ray.r * 0.8, ray.g * 0.8, ray.b * 0.8, { f: 0, spread: 0, wBase: Math.max(BEAM_WIDTH, w), since: 0 });
        return;
      }
      case 'piece':
        break;
      default:
        return;
    }
    const { p, def } = target;
    const l = loadOf(p.id);
    l.handled += P;
    l.hits++;
    if (p.cracked) {
      l.heat += P * 0.1;
      cont(ray.dx, ray.dy, ray.r * 0.9, ray.g * 0.9, ray.b * 0.9, { ig: p.id });
      return;
    }
    switch (p.type) {
      case 'mirror':
      case 'rotor': {
        const keep = p.type === 'mirror' ? mods.mirrorKeep : PIECES.rotor.keep;
        l.heat += P * (1 - keep);
        const n = reflect(ray.dx, ray.dy, target.seg.nx, target.seg.ny);
        cont(n.x, n.y, ray.r * keep, ray.g * keep, ray.b * keep, { ig: p.id });
        return;
      }
      case 'splitter': {
        const keep = mods.splitterKeep * 0.5;
        l.heat += P * (1 - mods.splitterKeep);
        const n = reflect(ray.dx, ray.dy, target.seg.nx, target.seg.ny);
        cont(n.x, n.y, ray.r * keep, ray.g * keep, ray.b * keep, { ig: p.id });
        cont(ray.dx, ray.dy, ray.r * keep, ray.g * keep, ray.b * keep, { ig: p.id });
        return;
      }
      case 'prism': {
        l.heat += P * def.absorb;
        const side = ray.dx * target.seg.nx + ray.dy * target.seg.ny >= 0 ? 1 : -1;
        const present = (ray.r > 1.5) + (ray.g > 1.5) + (ray.b > 1.5);
        const gain = present >= 2 ? finite(mods.prismGain, def.gain) : def.dullGain;
        const w = widthAt(ray, since);
        for (const ch of ['r', 'g', 'b']) {
          const pw = ray[ch] * gain;
          if (pw < MIN_POWER * 0.5) continue;
          const d = rotate(ray.dx, ray.dy, side * def.fan[ch]);
          cont(d.x, d.y, ch === 'r' ? pw : 0, ch === 'g' ? pw : 0, ch === 'b' ? pw : 0, { ig: p.id, f: 0, spread: 0, wBase: w, since: 0 });
        }
        if (mods.prismWhite > 0) {
          const s = mods.prismWhite;
          cont(ray.dx, ray.dy, ray.r * s, ray.g * s, ray.b * s, { ig: p.id });
        }
        return;
      }
      case 'filter-r':
      case 'filter-g':
      case 'filter-b': {
        const ch = def.channel;
        const kept = ray[ch] * mods.filterKeep;
        const rejected = P - ray[ch];
        l.heat += rejected * def.absorbRejected + ray[ch] * def.absorb;
        cont(ray.dx, ray.dy, ch === 'r' ? kept : 0, ch === 'g' ? kept : 0, ch === 'b' ? kept : 0, { ig: p.id, tint: mods.colourDamage });
        return;
      }
      case 'lens': {
        l.heat += P * def.absorb;
        const w = widthAt(ray, since);
        cont(ray.dx, ray.dy, ray.r * 0.96, ray.g * 0.96, ray.b * 0.96, { ig: p.id, wBase: w, f: mods.focusDist, wMin: mods.focusMin, spread: 0, since: 0 });
        return;
      }
      case 'concave': {
        l.heat += P * def.absorb;
        const w = widthAt(ray, since);
        cont(ray.dx, ray.dy, ray.r * 0.96, ray.g * 0.96, ray.b * 0.96, { ig: p.id, wBase: w, f: 0, spread: SPREAD, since: 0 });
        return;
      }
      case 'combiner': {
        l.heat += P * def.absorb;
        let c = combinerIn.get(p.id);
        if (!c) {
          c = { r: 0, g: 0, b: 0, n: 0, g2: target };
          combinerIn.set(p.id, c);
        }
        c.r += ray.r;
        c.g += ray.g;
        c.b += ray.b;
        c.n++;
        return;
      }
      case 'crystal': {
        let c = crystalIn.get(p.id);
        if (!c) {
          c = { r: 0, g: 0, b: 0 };
          crystalIn.set(p.id, c);
        }
        c.r += ray.r;
        c.g += ray.g;
        c.b += ray.b;
        return;
      }
      case 'shutter': {
        if (shutterOpen(p, t, mods)) {
          cont(ray.dx, ray.dy, ray.r, ray.g, ray.b, { ig: p.id, depth: ray.depth });
        } else l.heat += P * def.absorb;
        return;
      }
      case 'black':
        l.heat += P * def.absorb;
        return;
      default:
        return;
    }
  };

  const drain = () => {
    while (queue.length) {
      if (rays >= MAX_RAYS) {
        capped = true;
        queue.length = 0;
        break;
      }
      rays++;
      step(queue.pop());
    }
  };
  drain();
  // Combiners fire once per trace, after everything that could feed them has been traced (three rounds at most).
  const fired = new Set();
  for (let round = 0; round < 3; round++) {
    let any = false;
    for (const [id, c] of combinerIn) {
      if (fired.has(id)) continue;
      fired.add(id);
      const P = c.r + c.g + c.b;
      if (P < MIN_POWER) continue;
      const g = c.g2;
      const a = normDeg(g.p.angle) * DEG;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const keep = PIECES.combiner.keep;
      const ray = newRay(g.x + dx * (DISC + 1), g.y + dy * (DISC + 1), dx, dy, c.r * keep, c.g * keep, c.b * keep, null);
      ray.ig = id;
      ray.tint = mods.colourDamage;
      queue.push(ray);
      any = true;
    }
    if (!any) break;
    drain();
  }
  return { segments, load, heart, crystalIn, mimicHits, lampHits, rays, capped };
}

/** Segment crossings between beams of different colour (the sparkle sound), sampled at a low rate by the client. */
export function countColourCrossings(segments, limit = 64) {
  let n = 0;
  const m = Math.min(segments.length, limit);
  for (let i = 0; i < m; i++) {
    const a = segments[i];
    for (let j = i + 1; j < m; j++) {
      const b = segments[j];
      if (sameHue(a, b)) continue;
      const r = raySegment(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, b.x0, b.y0, b.x1, b.y1, 1e-6);
      if (r && r.t > 0.01 && r.t < 0.99 && r.u > 0.01 && r.u < 0.99) n++;
    }
  }
  return n;
}

export function sameHue(a, b) {
  const ha = hueOf(a);
  const hb = hueOf(b);
  return ha === hb;
}

/** 'white' | 'r' | 'g' | 'b' | 'mix' for a beam's channel powers. */
export function hueOf(c) {
  const r = finite(c.r);
  const g = finite(c.g);
  const b = finite(c.b);
  const P = r + g + b;
  if (P <= 0) return 'white';
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mn / P > 0.25) return 'white';
  if (mx / P > 0.8) return r === mx ? 'r' : g === mx ? 'g' : 'b';
  return 'mix';
}
