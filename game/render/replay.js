// The last moments of a night, kept so they can be watched again at half speed from the dawn page or the end of a
// run: the glass, the Lamps, the ink and the burns, sampled ten times a second. The beams are re-traced from the
// glass when the replay is drawn, so a frame costs a few hundred numbers, not a picture.

import { traceBeams } from '../sim/trace.js';

const KEEP = 14; // seconds of night kept
const STEP = 0.1; // seconds between samples

export function makeRecorder() {
  let frames = [];
  let events = [];
  let lastT = -1;
  let piecesKey = '';
  let pieces = [];
  let meta = null; // { board, mods }

  function clear() {
    frames = [];
    events = [];
    lastT = -1;
    piecesKey = '';
    pieces = [];
    meta = null;
  }

  /** One sample of the night as it is drawn (host or mirror alike). */
  function capture(N) {
    const S = N.S;
    if (!(S.t >= 0)) return;
    // A mirror's clock can step back a little when a snapshot lands; only a long way back is a new night.
    if (S.t < lastT - 2) clear();
    if (S.t - lastT < STEP) return;
    lastT = S.t;
    meta = { board: N.board, mods: N.mods };
    const key = S.pieces.map((p) => `${p.id}:${p.c}:${p.r}:${p.angle}:${p.cracked ? 1 : 0}`).join('|');
    if (key !== piecesKey) {
      piecesKey = key;
      pieces = S.pieces.map((p) => ({ id: p.id, type: p.type, c: p.c, r: p.r, angle: p.angle, t0: p.t0, cracked: p.cracked ? 1 : 0, heat: p.heat, store: p.store, pulseUntil: p.pulseUntil, pr: p.pr, pg: p.pg, pb: p.pb }));
    }
    const shades = [];
    for (const s of S.shades) {
      if (s.state === 'hit') continue;
      shades.push({ id: s.id, type: s.type, hue: s.hue, x: s.x, y: s.y, hp: s.hp, maxHp: s.maxHp, r: s.r, hx: s.hx, hy: s.hy, burn: s.burn, state: s.state === 'dead' ? 'dead' : s.state, diedAt: s.diedAt, seed: s.seed, phase: s.phase, eye: s.eye, born: s.born });
    }
    frames.push({
      t: S.t,
      pieces,
      lamps: S.lamps.map((L) => ({ x: L.x, y: L.y, angle: L.angle, power: L.power, radius: L.radius })),
      shades,
      heart: { hp: S.heart.hp, max: S.heart.max, shield: S.heart.shield },
      dawn: { charge: S.dawn.charge, max: S.dawn.max, active: S.dawn.until > S.t },
      shadows: S.shadows.map((z) => ({ ...z })),
      bands: S.bands.map((b) => ({ ...b })),
    });
    while (frames.length && frames[0].t < S.t - KEEP) frames.shift();
    while (events.length && events[0].t < S.t - KEEP) events.shift();
  }

  /** A burn worth seeing again (the night's own kill events). */
  function event(e, t) {
    if (e.k !== 'kill' || !(t >= 0)) return;
    if (events.length > 200) events.shift();
    events.push({ t, x: e.x, y: e.y, hue: e.hue, match: e.match, type: e.type, score: e.score });
  }

  /** The night at time t, eased between samples, ready for the scene. */
  function at(t) {
    if (frames.length < 2 || !meta) return null;
    let i = 0;
    while (i < frames.length - 2 && frames[i + 1].t <= t) i++;
    const a = frames[i];
    const b = frames[i + 1];
    const u = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-6, b.t - a.t)));
    const next = new Map(b.shades.map((s) => [s.id, s]));
    const shades = a.shades.map((s) => {
      const n = next.get(s.id);
      return n ? { ...s, x: s.x + (n.x - s.x) * u, y: s.y + (n.y - s.y) * u } : s;
    });
    const lamps = a.lamps.map((L, k) => {
      const n = b.lamps[k];
      if (!n) return L;
      const d = ((n.angle - L.angle + 540) % 360) - 180;
      return { ...L, angle: (L.angle + d * u + 360) % 360 };
    });
    const tr = traceBeams({ board: meta.board, pieces: a.pieces, lamps, t, mods: meta.mods, zones: { shadows: a.shadows, bands: a.bands, glooms: [], mimics: [] } });
    return { t, pieces: a.pieces, lamps, shades, segments: tr.segments, heart: a.heart, dawn: a.dawn, phase: 'wave', upcoming: [], shadows: a.shadows, bands: a.bands, mods: meta.mods, intensity: 1 };
  }

  return {
    clear,
    capture,
    event,
    at,
    /** Burns between two moments of the replay (to show again as they pass). */
    eventsBetween(t0, t1) {
      return events.filter((e) => e.t > t0 && e.t <= t1);
    },
    get board() {
      return meta ? meta.board : null;
    },
    get span() {
      return frames.length >= 2 ? { from: frames[0].t, to: frames[frames.length - 1].t } : null;
    },
  };
}
