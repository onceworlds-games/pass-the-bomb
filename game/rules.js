// Numbers and small pure helpers shared by every page and by the tests. Nothing here touches the window.

export const W = 24; // arena width in units
export const H = 14; // arena height in units
export const R = 0.45; // character radius
export const STEP = 1 / 60; // fixed simulation step in seconds

// Movement
export const SPEED = 6;
export const SPEED_HOLD = 6.6;
export const ACCEL = 40;
export const BRAKE = 80;
export const GHOST_SPEED = 5;
export const DASH_SPEED = 18;
export const DASH_TIME = 0.18;
export const DASH_CD = 2.5;
export const DASH_CD_HOLD = 1.8;

// Bomb timings, in milliseconds of match time
export const ARC_MS = 200; // the bomb flies to its new holder; no passing meanwhile
export const STUN_MS = 400; // after landing, the new holder can't move
export const IMMUNE_MS = 1500; // the one who passed can't get it back
export const FALL_MS = 550; // a dropped bomb falls onto its holder
export const FUSE_MIN = 8000; // short fuses keep rounds near 75 s, so nobody who is out waits long
export const FUSE_MAX = 14000;
export const FIRST_DROP_MS = 2000;
export const REDROP_MS = 1500;
export const ROUND_CAP_MS = 180000;
export const TAG_DIST = 2 * R + 0.15; // circles overlap, with a little forgiveness
export const NEVER = 1e15; // a fuse that never ends (the lobby's practice bomb)

// Screens, in milliseconds
export const BANNER_MS = 1500;
export const OVER_MS = 2200;
export const BETWEEN_MS = 4000;
export const FINAL_MS = 8500;

// The table
export const MAX_PLAYERS = 12;
export const TABLE = 8; // bots fill the match up to this many
export const ROUND_OPTIONS = [1, 3, 5];
export const DEFAULT_ROUNDS = 3;
export const MAP_IDS = ['backyard', 'beach', 'playground'];

// Place points for a round (1st, 2nd, ...); everyone further down gets OTHER_POINTS
export const PLACE_POINTS = [10, 7, 5, 4, 3, 2];
export const OTHER_POINTS = 1;

export function placePoints(place) {
  return place >= 0 && place < PLACE_POINTS.length ? PLACE_POINTS[place] : OTHER_POINTS;
}

/** One bomb for most of a round, two while seven or more players are still in. */
export function bombsWanted(alive) {
  if (alive < 2) return 0;
  return alive >= 7 ? 2 : 1;
}

// ---------------------------------------------------------------- random numbers

/** A small seeded generator (mulberry32): the same seed gives every page the same numbers. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash32(text) {
  let h = 2166136261 >>> 0;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- the roster

export const BOT_NAMES = ['Pip', 'Ziggy', 'Bubbles', 'Noodle', 'Pickles', 'Mochi', 'Sprout', 'Bean', 'Waffles', 'Taco', 'Biscuit', 'Peanut', 'Jelly', 'Nugget'];

// Twelve bright, well-apart colors (body, darker shade for the outline's inside).
export const PLAYER_COLORS = [
  '#ff4b4b', // red
  '#ff8a1f', // orange
  '#ffd21f', // yellow
  '#a6e22e', // lime
  '#17b45a', // green
  '#14c9c9', // teal
  '#38a8ff', // sky
  '#4458ff', // blue
  '#9b5cff', // purple
  '#ff5cc8', // pink
  '#b8742a', // brown
  '#e9e9f5', // white
];

export function cleanName(name) {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return (s || 'Player').slice(0, 16);
}

/** A color index for someone who has no roster slot yet (the lobby). */
export function colorOfId(id) {
  return hash32(id) % PLAYER_COLORS.length;
}

/**
 * The match's roster, built once by the host: the humans (match.participants) first, then bots up to the table size.
 * More humans than the table: no bots. Entries: { id, n: name, b: 1 for a bot, c: color index }.
 */
export function buildRoster(humanIds, seed, nameOf, table = TABLE) {
  const rand = rng((seed >>> 0) ^ 0x9e3779b9);
  const colors = shuffle(PLAYER_COLORS.map((_, i) => i), rand);
  const names = shuffle(BOT_NAMES, rand);
  const out = [];
  for (const id of humanIds.slice(0, MAX_PLAYERS)) out.push({ id, n: cleanName(nameOf(id)), b: 0, c: colors[out.length % colors.length] });
  let k = 1;
  while (out.length < table) {
    out.push({ id: 'bot' + k, n: names[(k - 1) % names.length], b: 1, c: colors[out.length % colors.length] });
    k++;
  }
  return out;
}

/** Plain deep copy of JSON data (the room's state records). */
export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
