// The player's profile: progress, unlocks, the almanac, cosmetics, hint counters. One versioned save, parsed
// defensively (missing, empty, corrupt, older or newer all load), written on meaningful events and flushed when
// the page hides.

import { platform } from './platform.js';
import { SHADE_IDS } from './sim/shades.js';
import { FELTS, BRASSES } from './render/felt.js';
import { finite, clamp } from './sim/geom.js';

export const PROFILE_VERSION = 1;
const KEY = 'profile';

export const BEAM_STYLES = ['classic', 'thread', 'ember'];
export const HEART_SKINS = ['glass', 'ember', 'moon'];

export function defaultProfile() {
  return {
    v: PROFILE_VERSION,
    runs: 0,
    wins: 0,
    bestScore: 0,
    bestNight: 0,
    bestEndless: 0,
    nightsPlayed: 0,
    kills: 0,
    bosses: {}, // type -> kills
    boardsWon: {},
    ascensionWon: 0,
    tutorialDone: false,
    almanac: {}, // type -> { met, killed }
    cosmetics: { felt: 'green', brass: 'brass', beam: 'classic', heart: 'glass' },
    hints: {}, // id -> times shown
    daily: { day: 0, score: 0 },
    badges: {},
    lastKit: 'observer',
    lastBoard: 'octagon',
    lastAscension: 0,
  };
}

export function parseProfile(raw) {
  const p = defaultProfile();
  if (!raw || typeof raw !== 'object') return p;
  const n = (k, lo, hi) => (p[k] = clamp(finite(raw[k], p[k]), lo, hi) | 0);
  n('runs', 0, 1e6);
  n('wins', 0, 1e6);
  n('bestScore', 0, 1e9);
  n('bestNight', 0, 999);
  n('bestEndless', 0, 999);
  n('nightsPlayed', 0, 1e6);
  n('kills', 0, 1e9);
  n('ascensionWon', 0, 8);
  p.tutorialDone = !!raw.tutorialDone;
  if (raw.bosses && typeof raw.bosses === 'object') for (const [k, v] of Object.entries(raw.bosses)) if (SHADE_IDS.includes(k)) p.bosses[k] = clamp(finite(v, 0), 0, 1e6) | 0;
  if (raw.boardsWon && typeof raw.boardsWon === 'object') for (const [k, v] of Object.entries(raw.boardsWon)) if (typeof k === 'string' && k.length < 16) p.boardsWon[k] = clamp(finite(v, 0), 0, 1e6) | 0;
  if (raw.almanac && typeof raw.almanac === 'object') {
    for (const [k, v] of Object.entries(raw.almanac)) {
      if (!SHADE_IDS.includes(k) || !v || typeof v !== 'object') continue;
      p.almanac[k] = { met: !!v.met, killed: clamp(finite(v.killed, 0), 0, 1e7) | 0 };
    }
  }
  if (raw.cosmetics && typeof raw.cosmetics === 'object') {
    const c = raw.cosmetics;
    if (FELTS[c.felt]) p.cosmetics.felt = c.felt;
    if (BRASSES[c.brass]) p.cosmetics.brass = c.brass;
    if (BEAM_STYLES.includes(c.beam)) p.cosmetics.beam = c.beam;
    if (HEART_SKINS.includes(c.heart)) p.cosmetics.heart = c.heart;
  }
  if (raw.hints && typeof raw.hints === 'object') for (const [k, v] of Object.entries(raw.hints)) if (typeof k === 'string' && k.length < 32) p.hints[k] = clamp(finite(v, 0), 0, 99) | 0;
  if (raw.daily && typeof raw.daily === 'object') p.daily = { day: clamp(finite(raw.daily.day, 0), 0, 1e7) | 0, score: clamp(finite(raw.daily.score, 0), 0, 1e9) | 0 };
  if (raw.badges && typeof raw.badges === 'object') for (const [k, v] of Object.entries(raw.badges)) if (typeof k === 'string' && k.length < 32 && v) p.badges[k] = true;
  if (typeof raw.lastKit === 'string' && raw.lastKit.length < 16) p.lastKit = raw.lastKit;
  if (typeof raw.lastBoard === 'string' && raw.lastBoard.length < 16) p.lastBoard = raw.lastBoard;
  p.lastAscension = clamp(finite(raw.lastAscension, 0), 0, 8) | 0;
  return p;
}

/** Which cosmetics the profile has earned (everything is earned by playing, nothing is bought). */
export function cosmeticUnlocks(p) {
  return {
    felt: { green: true, oxblood: p.bestNight >= 4, navy: p.wins >= 1, slate: p.bestNight >= 8 },
    brass: { brass: true, silver: p.kills >= 500, gunmetal: p.wins >= 2 },
    beam: { classic: true, thread: p.bestNight >= 6, ember: !!p.bosses.lenseater },
    heart: { glass: true, ember: !!p.bosses.umbra, moon: p.bestEndless >= 3 },
  };
}

export function loadProfile() {
  return platform.save.get(KEY).then(parseProfile).catch(() => defaultProfile());
}

/** A profile store that writes at most every few seconds and flushes when the page hides. */
export function makeProfileStore(initial) {
  let p = initial;
  let dirty = false;
  let timer = 0;
  const write = () => {
    if (!dirty) return;
    dirty = false;
    platform.save.set(KEY, p).catch(() => {});
  };
  const schedule = () => {
    dirty = true;
    if (!timer) timer = setTimeout(() => ((timer = 0), write()), 2500);
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.hidden && write());
  return {
    get p() {
      return p;
    },
    set(fn) {
      fn(p);
      schedule();
    },
    flush: write,
    /** Shows a hint the first `times` times it is asked for; returns true when it should be shown now. */
    hint(id, times = 3) {
      const n = p.hints[id] || 0;
      if (n >= times) return false;
      p.hints[id] = n + 1;
      schedule();
      return true;
    },
  };
}
