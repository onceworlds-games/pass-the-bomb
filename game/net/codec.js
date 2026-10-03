// Packing for what travels every tick: Shade snapshots as compact arrays (about 14 numbers each, ints), with
// shape checks on the way back in. Room state and messages stay JSON, so this is about size, not bytes.

import { finite, clamp } from '../sim/geom.js';
import { isShadeType, MAX_SHADES } from '../sim/shades.js';

/** A snapshot message from the host: { t: 'snap', seq, nt, lamps, shades, heat } */
export function packSnapshot(N, seq) {
  const S = N.S;
  return {
    t: 'snap',
    seq,
    nt: Math.round(S.t * 100) / 100,
    ph: S.phase,
    wv: S.wave,
    wt: Math.round(S.waveT * 10) / 10,
    hp: Math.round(S.heart.hp),
    dc: Math.round(S.dawn.charge * 10) / 10,
    du: Math.round(S.dawn.until * 10) / 10,
    sh: Math.round(S.heart.shield * 10) / 10,
    lamps: S.lamps.map((L) => [Math.round(L.angle), Math.round(L.power)]),
    shades: N.exportShades(),
    heat: N.exportHeat(),
    focus: Object.fromEntries(Object.values(S.players).map((pl) => [pl.id, [Math.round(pl.focus), Math.round(pl.flareAt * 10) / 10, Math.round(pl.surgeAt * 10) / 10]])),
    shadows: S.shadows.map((z) => [Math.round(z.x), Math.round(z.y), z.r]),
    bands: S.bands.map((b) => [Math.round(b.x0), Math.round(b.x1)]),
  };
}

/** Applies a snapshot to a mirror night. Everything is range-checked; anything odd is dropped. */
export function applySnapshot(M, m) {
  if (!m || typeof m !== 'object') return false;
  const S = M.S;
  S.t = clamp(finite(m.nt, S.t), 0, 1e6);
  if (['dusk', 'wave', 'break', 'done', 'lost'].includes(m.ph)) S.phase = m.ph;
  S.wave = clamp(finite(m.wv, S.wave), -1, 20) | 0;
  S.waveT = clamp(finite(m.wt, 0), 0, 1e6);
  S.heart.hp = clamp(finite(m.hp, S.heart.hp), 0, 9999);
  S.dawn.charge = clamp(finite(m.dc, 0), 0, S.dawn.max);
  S.dawn.until = clamp(finite(m.du, 0), 0, 1e6);
  S.heart.shield = clamp(finite(m.sh, 0), 0, 60);
  if (Array.isArray(m.lamps)) {
    m.lamps.slice(0, 8).forEach((l, i) => {
      const L = S.lamps[i];
      if (!L || !Array.isArray(l)) return;
      L.angle = clamp(finite(l[0], L.angle), 0, 360);
      L.target = L.angle;
      L.power = clamp(finite(l[1], 0), 0, 5000);
    });
  }
  if (Array.isArray(m.shades) && m.shades.length <= MAX_SHADES + 40) M.importShades(m.shades.filter((a) => Array.isArray(a) && isShadeType(a[1])));
  if (Array.isArray(m.heat)) M.importHeat(m.heat);
  if (m.focus && typeof m.focus === 'object') {
    for (const [id, v] of Object.entries(m.focus)) {
      if (!Array.isArray(v) || typeof id !== 'string' || id.length > 64) continue;
      const pl = M.addPlayer(id);
      pl.focus = clamp(finite(v[0], pl.focus), 0, 500);
      pl.flareAt = clamp(finite(v[1], 0), 0, 1e6);
      pl.surgeAt = clamp(finite(v[2], 0), 0, 1e6);
    }
  }
  S.shadows = Array.isArray(m.shadows) ? m.shadows.slice(0, 12).filter(Array.isArray).map((z) => ({ x: finite(z[0]), y: finite(z[1]), r: clamp(finite(z[2], 80), 10, 300), until: Infinity })) : [];
  S.bands = Array.isArray(m.bands) ? m.bands.slice(0, 4).filter(Array.isArray).map((b) => ({ x0: finite(b[0]), x1: finite(b[1]), factor: 0.3, speed: 0, until: Infinity })) : [];
  return true;
}

/** A command from a player to the host. */
export function validCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return false;
  if (typeof cmd.op !== 'string' || cmd.op.length > 12) return false;
  for (const k of Object.keys(cmd)) {
    const v = cmd[k];
    if (typeof v === 'number' && !Number.isFinite(v)) return false;
    if (typeof v === 'string' && v.length > 32) return false;
    if (typeof v === 'object' && v !== null) return false;
  }
  return true;
}

/** Events the host forwards each tick, trimmed to what the other pages draw and play. */
const FORWARD = new Set(['kill', 'crack', 'shatter', 'pulse', 'hearthit', 'wave', 'cleared', 'flare', 'dawn', 'surge', 'eaten', 'moth', 'done', 'lost', 'spawn', 'placed', 'moved', 'rotated', 'sold', 'shadow', 'band', 'flicker', 'repair']);
export function packEvents(events) {
  const out = [];
  for (const e of events) {
    if (!FORWARD.has(e.k)) continue;
    const c = { k: e.k };
    for (const key of ['id', 'type', 'hue', 'x', 'y', 'score', 'wave', 'of', 'dmg', 'hp', 'by', 'night', 'c', 'r', 'pid', 'last', 'focused', 'match', 'power', 'boss', 'warden', 'lamp', 'depth', 'fast', 'split']) {
      if (e[key] !== undefined) c[key] = typeof e[key] === 'number' ? Math.round(e[key] * 10) / 10 : e[key];
    }
    out.push(c);
    if (out.length >= 60) break;
  }
  return out;
}

export function validEvent(e) {
  if (!e || typeof e !== 'object' || typeof e.k !== 'string' || !FORWARD.has(e.k)) return false;
  for (const k of Object.keys(e)) {
    const v = e[k];
    if (typeof v === 'number' && !Number.isFinite(v)) return false;
    if (typeof v === 'string' && v.length > 40) return false;
    if (typeof v === 'object' && v !== null) return false;
  }
  return true;
}
