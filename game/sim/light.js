// The light on the felt: a coarse brightness map (Shades steer away from it and slow in it; the felt brightens
// where it falls) and the damage beams do to Shades.

import { CELL } from './boards.js';
import { clamp, finite, pointSegment } from './geom.js';
import { segmentWidthAt } from './trace.js';
import { SHADES, K_DAMAGE, W0, colourMult, effectiveHue } from './shades.js';

export const LCELL = 32;
export const HALO = 26; // px beyond the core where a beam still scorches
export const HALO_SHARE = 0.35; // the halo's damage at its inner edge

export function makeLightMap(board) {
  const cols = Math.ceil(board.w / LCELL) + 4;
  const rows = Math.ceil(board.h / LCELL) + 4;
  const data = new Float32Array(cols * rows);
  const map = {
    cols,
    rows,
    data,
    clear() {
      data.fill(0);
    },
    /** Brightness at a point (about 1 under a fresh 100-power beam), bilinear. */
    sample(x, y) {
      const fx = finite(x) / LCELL + 2 - 0.5;
      const fy = finite(y) / LCELL + 2 - 0.5;
      const c0 = Math.floor(fx);
      const r0 = Math.floor(fy);
      const tx = fx - c0;
      const ty = fy - r0;
      let s = 0;
      for (let k = 0; k < 4; k++) {
        const c = c0 + (k & 1);
        const r = r0 + (k >> 1);
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        s += data[r * cols + c] * (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty);
      }
      return s;
    },
    /** Brightness gradient (per LCELL) at a point: Shades walk down it. */
    gradient(x, y) {
      const h = LCELL * 0.75;
      return { x: (map.sample(x + h, y) - map.sample(x - h, y)) / 2, y: (map.sample(x, y + h) - map.sample(x, y - h)) / 2 };
    },
    /** Rebuilds the map from traced segments. */
    build(segments) {
      data.fill(0);
      const step = LCELL * 0.5;
      for (const seg of segments) {
        const P = seg.r + seg.g + seg.b;
        if (!(P > 0) || !(seg.len > 0)) continue;
        const n = Math.max(1, Math.ceil(seg.len / step));
        for (let i = 0; i <= n; i++) {
          const d = (seg.len * i) / n;
          const w = segmentWidthAt(seg, d);
          // A 100-power beam lights its cells to about 1; a wide beam lights a wider, slightly larger pool.
          const base = (P / 100) * (step / LCELL) * (i === 0 || i === n ? 0.5 : 1);
          const radius = Math.max(0, Math.round(w / 2 / LCELL));
          const c = Math.floor((seg.x0 + seg.dx * d) / LCELL) + 2;
          const r = Math.floor((seg.y0 + seg.dy * d) / LCELL) + 2;
          if (radius === 0) {
            if (c >= 0 && r >= 0 && c < cols && r < rows) data[r * cols + c] += base;
            continue;
          }
          let norm = 0;
          for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) norm += Math.max(0, 1 - Math.hypot(dc, dr) / (radius + 1));
          const share = (base * (1 + radius * 0.5)) / norm;
          for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
              const cc = c + dc;
              const rr = r + dr;
              if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
              const fall = 1 - Math.hypot(dc, dr) / (radius + 1);
              if (fall > 0) data[rr * cols + cc] += share * fall;
            }
          }
        }
      }
      for (let i = 0; i < data.length; i++) if (data[i] > 4) data[i] = 4;
    },
  };
  return map;
}

/**
 * Burns Shades with the traced beams for one tick. Mutates hp, burn and hit bookkeeping; returns the kills in
 * order, each { shade, by: { hue, focused, lamp }, fast }. Damage per second = K * P * colour * (W0 / width).
 */
export function burnShades(segments, shades, dt, ctx) {
  const { mods, t, dawn, hitMul } = ctx;
  const kills = [];
  const dmgMul = finite(mods.damage, 1) * (dawn ? 2 : 1);
  for (const s of shades) {
    if (s.state === 'dead' || s.state === 'hit') continue;
    const def = SHADES[s.type] || SHADES.wisp;
    s.burn *= Math.max(0, 1 - dt * 4);
    let total = 0;
    let bestHit = null;
    for (const seg of segments) {
      const P = seg.r + seg.g + seg.b;
      if (!(P > 0)) continue;
      // Quick reject: a box around the segment grown by the widest it gets plus the Shade.
      const grow = Math.max(seg.w0, seg.w1) * 0.5 + s.r + HALO;
      if (s.x < Math.min(seg.x0, seg.x1) - grow || s.x > Math.max(seg.x0, seg.x1) + grow) continue;
      if (s.y < Math.min(seg.y0, seg.y1) - grow || s.y > Math.max(seg.y0, seg.y1) + grow) continue;
      const q = pointSegment(s.x, s.y, seg.x0, seg.y0, seg.x1, seg.y1);
      const w = segmentWidthAt(seg, q.u * seg.len);
      const inner = w * 0.5 + s.r;
      if (q.d > inner + HALO) continue;
      // The core burns in full; the halo around it scorches, fading out over HALO px.
      const halo = q.d > inner ? HALO_SHARE * (1 - (q.d - inner) / HALO) : 1;
      const focused = w <= finite(mods.focusMin, 3) + 0.75 && halo === 1;
      let mult = halo * colourMult(s, seg, mods) * (W0 / Math.max(1, w)) * (seg.tint || 1) * (focused ? finite(mods.lensBoost, 1) : 1);
      if (hitMul) mult *= hitMul(s, seg, q, w);
      if (!(mult > 0)) continue;
      const dps = K_DAMAGE * P * mult * dmgMul;
      total += dps * dt;
      if (!bestHit || dps > bestHit.dps) bestHit = { dps, hue: hueKey(seg), focused, lamp: seg.lamp, depth: seg.depth };
    }
    if (total > 0) {
      if (s.firstHit < 0) s.firstHit = t;
      s.hp -= total;
      s.burn = Math.min(1, s.burn + total / Math.max(8, s.maxHp * 0.25));
      s.lastHit = bestHit;
      if (s.hp <= 0) {
        s.hp = 0;
        s.state = 'dead';
        kills.push({ shade: s, by: bestHit, fast: t - s.firstHit <= 1.0, match: bestHit && bestHit.hue === effectiveHue(s) });
      }
    }
    if (def.boss) s.lastDps = total / Math.max(dt, 1e-6);
  }
  return kills;
}

export function hueKey(seg) {
  const P = seg.r + seg.g + seg.b;
  if (!(P > 0)) return 'w';
  const mx = Math.max(seg.r, seg.g, seg.b);
  const mn = Math.min(seg.r, seg.g, seg.b);
  if (mn / P > 0.25) return 'w';
  if (mx / P > 0.8) return seg.r === mx ? 'r' : seg.g === mx ? 'g' : 'b';
  return 'mix';
}

export const cellBrightness = (map, c, r) => {
  const x = (c + 0.5) * CELL;
  const y = (r + 0.5) * CELL;
  return clamp(map.sample(x, y), 0, 4);
};
