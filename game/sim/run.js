// The run: twelve nights, a deck of glass, relics, drafts at dawn, Fates, kits, boards, ascensions and the daily.
// Plain data (saved as it is) and pure functions over it.

import { baseMods, isPieceType, PIECES } from './pieces.js';
import { RELICS, UPGRADES, FATES, FATE_IDS, RELIC_IDS, UPGRADE_IDS, addRelic } from './relics.js';
import { makeRng, hashString } from './rng.js';
import { RUN_NIGHTS, bossFor } from './waves.js';
import { BOARD_DEFS } from './boards.js';
import { clamp, finite } from './geom.js';

export const RUN_VERSION = 1;

export const KITS = {
  observer: { id: 'observer', name: 'Observer', text: 'Four mirrors, a splitter, a prism, a lens.', deck: { mirror: 4, splitter: 1, prism: 1, lens: 1 }, mods: {}, unlock: null },
  smith: { id: 'smith', name: 'Smith', text: 'Six mirrors, two splitters, a lens. Cheap Focus.', deck: { mirror: 6, splitter: 2, lens: 1 }, mods: { focusCost: 0.7, sellRefund: 0.5 }, unlock: 'night4' },
  alchemist: { id: 'alchemist', name: 'Alchemist', text: 'Two mirrors, a prism, three filters, a combiner. Colour burns harder.', deck: { mirror: 2, prism: 1, 'filter-r': 1, 'filter-g': 1, 'filter-b': 1, combiner: 1 }, mods: { colourDamage: 1.2 }, unlock: 'umbra' },
  watchman: { id: 'watchman', name: 'Watchman', text: 'Two Lamps. Three mirrors and a lens.', deck: { mirror: 3, lens: 1 }, mods: { extraLamp: 0.8, lampPower: 0.85 }, unlock: 'night8' },
};
export const KIT_IDS = Object.keys(KITS);

export const ROLES = {
  smith: { id: 'smith', name: 'Smith', text: 'Focus costs 30% less; selling refunds 70%.' },
  seer: { id: 'seer', name: 'Seer', text: 'Sees every wave of the forecast.' },
  warden: { id: 'warden', name: 'Warden', text: 'A Flare also shields the Heart for 8 s.' },
  alchemist: { id: 'alchemist', name: 'Alchemist', text: 'Filters and combiners burn 20% harder.' },
};
export const ROLE_IDS = Object.keys(ROLES);

// Longer Dusk: each level adds a rule and keeps the ones below it.
export const ASCENSIONS = [
  'Shades carry 10% more ink.',
  'Focus returns 6 a second.',
  'The Lamp breathes wider: 0.5 to 1.5.',
  'Veils everywhere.',
  'Glass cools 25% slower.',
  'Eaters from the first night.',
  'Dusk lasts 45 seconds.',
  'The Heart holds 60.',
];
export const MAX_ASCENSION = ASCENSIONS.length;

export const DAILY_MODS = {
  'new-moon': { name: 'New Moon', text: 'Every night is a new moon.', apply: (m, R) => (R.flags.moonFixed = 0.65) },
  'thin-glass': { name: 'Thin Glass', text: 'Glass heats 30% faster.', apply: (m) => (m.heatRate *= 1.3) },
  'quick-dark': { name: 'Quick Dark', text: 'Shades move 15% faster.', apply: (m) => (m.shadeSpeed = 1.15) },
  'rich-lamp': { name: 'Rich Lamp', text: 'Lamp power +20%.', apply: (m) => (m.lampPower *= 1.2) },
  'moths': { name: 'Moths', text: 'Moths from the first night.', apply: (m, R) => (R.flags.moths = true) },
  'deep-pockets': { name: 'Deep Pockets', text: 'Focus holds 150.', apply: (m) => (m.focusMax = 150) },
};

const MOON = [
  { name: 'Full moon', f: 1.05 },
  { name: 'Waning gibbous', f: 0.98 },
  { name: 'Last quarter', f: 0.88 },
  { name: 'Waning crescent', f: 0.76 },
  { name: 'New moon', f: 0.65 },
  { name: 'Waxing crescent', f: 0.76 },
  { name: 'First quarter', f: 0.88 },
  { name: 'Waxing gibbous', f: 0.98 },
];

export function moonFor(R) {
  if (R.flags && R.flags.moonFixed) return { name: 'New moon', f: R.flags.moonFixed };
  const i = (hashString(`moon:${R.seed}`) + R.night) % 8;
  return MOON[i];
}

/** The day number a Daily Dusk is keyed by (the platform clock, in UTC days). */
export const dailyDay = (now) => Math.floor(finite(now, 0) / 86400000);

export function dailySetup(day) {
  const rng = makeRng(hashString(`daily:${day}`));
  const ids = rng.shuffle(Object.keys(DAILY_MODS)).slice(0, 2);
  return { seed: hashString(`daily-seed:${day}`), mods: ids, kit: 'observer', boardId: 'octagon' };
}

/**
 * A new run. `kit`, `boardId` and `ascension` are the host's picks; `daily` is a day number for Daily Dusk.
 */
export function createRun({ seed, kit = 'observer', boardId = 'octagon', ascension = 0, daily = null, tutorial = false, now = 0 } = {}) {
  const K = KITS[kit] || KITS.observer;
  const B = BOARD_DEFS[boardId] ? boardId : 'octagon';
  let s = finite(seed, hashString(`${now}:${Math.random()}`));
  let dailyMods = [];
  let kitId = K.id;
  let board = B;
  if (daily != null) {
    const d = dailySetup(daily);
    s = d.seed;
    dailyMods = d.mods;
    kitId = d.kit;
    board = d.boardId;
    ascension = 0;
  }
  const deck = { ...KITS[kitId].deck };
  return {
    v: RUN_VERSION,
    id: hashString(`${s}:${now}`).toString(36),
    seed: s >>> 0,
    kit: kitId,
    boardId: board,
    ascension: clamp(finite(ascension, 0), 0, MAX_ASCENSION) | 0,
    daily: daily == null ? null : daily | 0,
    dailyMods,
    tutorial: !!tutorial,
    night: 1,
    phase: 'dusk', // dusk | night | dawn | won | lost
    endless: false,
    deck,
    relics: [],
    upgrades: [],
    heart: { hp: 100, max: 100 },
    score: 0,
    ledger: [], // one entry per finished night
    draft: null,
    fate: null,
    flags: {},
    rngState: makeRng(hashString(`run:${s}`)).state,
    startedAt: now,
    bestWaveless: 0,
  };
}

/** The modifiers a night runs with: kit, relics, upgrades, ascension, daily and co-op roles folded together. */
export function runMods(R, roles = []) {
  const m = baseMods();
  const K = KITS[R.kit] || KITS.observer;
  Object.assign(m, K.mods);
  for (const id of R.relics) RELICS[id]?.apply(m);
  for (const id of R.upgrades) UPGRADES[id]?.apply(m);
  for (const id of R.dailyMods || []) DAILY_MODS[id]?.apply(m, R);
  const A = R.ascension | 0;
  if (A >= 2) m.focusRegen = Math.min(m.focusRegen, 6);
  if (A >= 3) {
    m.breathLow = Math.min(m.breathLow, 0.5);
    m.breathHigh = Math.max(m.breathHigh, 1.5);
  }
  if (A >= 5) m.cooling *= 0.75;
  if (A >= 7) m.duskCap = 45;
  if (A >= 8) m.heartHp = Math.min(m.heartHp, 60);
  if (R.flags.lampMult) m.lampPower *= R.flags.lampMult;
  if (R.flags.coolMult) m.cooling *= R.flags.coolMult;
  if (R.flags.focusLess) m.focusMax = Math.max(40, m.focusMax - R.flags.focusLess);
  if (roles.includes('seer')) m.forecastAll = true;
  if (roles.includes('alchemist')) m.colourDamage = Math.max(m.colourDamage, 1.2);
  m.heartHp = Math.max(m.heartHp, R.heart.max);
  return m;
}

/** What createNight needs for the night the run is on. */
export function nightConfig(R, board, players) {
  const roles = players.map((p) => p.role).filter(Boolean);
  const mods = runMods(R, roles);
  const moon = moonFor(R);
  return {
    seed: R.seed,
    night: R.night,
    board,
    mods,
    deck: { ...R.deck },
    players,
    heart: { hp: R.heart.hp, max: Math.max(R.heart.max, mods.heartHp) },
    tutorial: R.tutorial && R.night === 1,
    ascension: R.ascension,
    lampPower: 100,
    moon: moon.f,
    flags: { moths: !!R.flags.moths, gloomNext: R.flags.gloomNext === R.night, hpNext: R.flags.hpNext === R.night },
  };
}

/** Closes a night: the ledger, losses, repairs, the Heart's rest, the next draft. */
export function endNight(R, N, now = 0) {
  const S = N.S;
  const won = S.phase === 'done';
  const entry = { night: R.night, won, score: S.stats.score, kills: S.stats.kills, heart: Math.round(S.heart.hp), cracks: S.stats.cracks, shatters: S.stats.shatters, waves: S.stats.wavesCleared, lostBy: won ? null : S.lostBy || null };
  R.ledger.push(entry);
  R.score += S.stats.score;
  R.heart.hp = Math.round(S.heart.hp);
  R.heart.max = S.heart.max;
  if (!won) {
    R.phase = 'lost';
    R.endedAt = now;
    return entry;
  }
  const mods = runMods(R);
  // Shattered glass is gone unless an Anvil mends it; what the Lens-Eater swallowed comes back at dawn.
  if (!mods.repairAtDawn) for (const t of S.lost) if (R.deck[t] > 0) R.deck[t]--;
  R.heart.hp = Math.min(R.heart.max, R.heart.hp + 15);
  R.phase = 'dawn';
  R.draft = makeDraft(R);
  R.fate = fateFor(R);
  return entry;
}

const PIECE_UNLOCK = { mirror: 1, splitter: 1, prism: 1, lens: 1, concave: 2, 'filter-r': 2, 'filter-g': 2, 'filter-b': 2, heatsink: 3, rotor: 3, combiner: 4, shutter: 4, crystal: 5, black: 5 };

function runRng(R, label) {
  return makeRng((hashString(`${label}:${R.seed}:${R.night}`) ^ R.rngState) >>> 0);
}

/** Three choices at dawn: at least one is glass, so the deck always grows. */
export function makeDraft(R) {
  const rng = runRng(R, 'draft');
  const options = [];
  const have = (t) => R.deck[t] || 0;
  const pieceTypes = Object.keys(PIECE_UNLOCK).filter((t) => PIECE_UNLOCK[t] <= R.night + 1);
  const weightOf = (t) => {
    let w = 1;
    if (t === 'mirror') w = 1.4;
    if (t === 'lens') w = 1.2;
    if (t === 'prism' && have('prism') === 0) w = 1.8;
    if (t.startsWith('filter') && have(t) === 0) w = 1.3;
    if (have(t) >= 4) w *= 0.3;
    return w;
  };
  const pickPiece = (exclude) => {
    const pool = pieceTypes.filter((t) => !exclude.includes(t));
    let total = 0;
    for (const t of pool) total += weightOf(t);
    let x = rng.next() * total;
    for (const t of pool) {
      x -= weightOf(t);
      if (x <= 0) return t;
    }
    return pool[pool.length - 1];
  };
  const p1 = pickPiece([]);
  options.push({ kind: 'piece', id: p1, n: p1 === 'mirror' ? 2 : 1, name: PIECES[p1].name, text: PIECES[p1].tip });
  const relicsLeft = RELIC_IDS.filter((id) => !R.relics.includes(id));
  const upgradesLeft = UPGRADE_IDS.filter((id) => !R.upgrades.includes(id));
  const count = R.flags.draftFewer ? 2 : 3;
  R.flags.draftFewer = false;
  // Second slot: glass or an upgrade. Third: a relic when any remain.
  if (upgradesLeft.length && rng.chance(0.45)) {
    const id = rng.pick(upgradesLeft);
    options.push({ kind: 'upgrade', id, name: UPGRADES[id].name, text: UPGRADES[id].text });
  } else {
    const p2 = pickPiece([p1]);
    options.push({ kind: 'piece', id: p2, n: p2 === 'mirror' ? 2 : 1, name: PIECES[p2].name, text: PIECES[p2].tip });
  }
  if (count > 2) {
    if (relicsLeft.length) {
      const id = rng.pick(relicsLeft);
      options.push({ kind: 'relic', id, name: RELICS[id].name, text: RELICS[id].text });
    } else {
      const p3 = pickPiece([p1]);
      options.push({ kind: 'piece', id: p3, n: 1, name: PIECES[p3].name, text: PIECES[p3].tip });
    }
  }
  return { night: R.night, options, taken: -1 };
}

export function applyDraft(R, index) {
  if (!R.draft || R.draft.taken >= 0) return false;
  const o = R.draft.options[index | 0];
  if (!o) return false;
  if (o.kind === 'piece' && isPieceType(o.id)) R.deck[o.id] = (R.deck[o.id] || 0) + (o.n || 1);
  else if (o.kind === 'relic') addRelic(R, o.id);
  else if (o.kind === 'upgrade' && UPGRADES[o.id] && !R.upgrades.includes(o.id)) R.upgrades.push(o.id);
  else return false;
  R.draft.taken = index | 0;
  return true;
}

/** A Fate on nights 2, 5, 7 and 10 (and every third night in Endless), never one already met. */
export function fateFor(R) {
  const due = [2, 5, 7, 10].includes(R.night) || (R.night > RUN_NIGHTS && R.night % 3 === 0);
  if (!due) return null;
  const seen = R.flags.fatesSeen || [];
  const left = FATE_IDS.filter((id) => !seen.includes(id));
  if (!left.length) return null;
  const rng = runRng(R, 'fate');
  const id = rng.pick(left);
  return { id, night: R.night, name: FATES[id].name, text: FATES[id].text, take: FATES[id].take, taken: -1 };
}

export function applyFate(R, take) {
  if (!R.fate || R.fate.taken >= 0) return false;
  const F = FATES[R.fate.id];
  if (!F) return false;
  R.flags.fatesSeen = [...(R.flags.fatesSeen || []), R.fate.id];
  if (take) F.effect(R, runRng(R, 'fate-effect'));
  R.fate.taken = take ? 1 : 0;
  return true;
}

/** Dawn is over: on to the next night (or the win, or Endless). */
export function nextNight(R) {
  if (R.phase !== 'dawn') return R;
  if (R.night >= RUN_NIGHTS && !R.endless) {
    R.phase = 'won';
    return R;
  }
  R.night++;
  R.phase = 'dusk';
  R.draft = null;
  R.fate = null;
  return R;
}

/** After a win, the table stays open: night 13 and on, until the Heart goes out. */
export function goEndless(R) {
  if (R.phase !== 'won') return R;
  R.endless = true;
  R.night++;
  R.phase = 'dusk';
  R.draft = null;
  R.fate = null;
  return R;
}

/** Nights survived in Endless (for the endless-nights board). */
export const endlessNights = (R) => Math.max(0, (R.ledger.filter((e) => e.won).length || 0) - RUN_NIGHTS);

/** A saved run, parsed defensively: anything missing or odd becomes a sane value; a wrong version is refused. */
export function parseRun(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== RUN_VERSION) return null;
  try {
    const R = createRun({ seed: finite(raw.seed, 1), kit: raw.kit, boardId: raw.boardId, ascension: raw.ascension, daily: raw.daily ?? null, tutorial: !!raw.tutorial, now: finite(raw.startedAt, 0) });
    R.id = typeof raw.id === 'string' ? raw.id.slice(0, 24) : R.id;
    R.night = clamp(finite(raw.night, 1), 1, 999) | 0;
    R.phase = ['dusk', 'night', 'dawn', 'won', 'lost'].includes(raw.phase) ? raw.phase : 'dusk';
    if (R.phase === 'night') R.phase = 'dusk';
    R.endless = !!raw.endless;
    R.deck = {};
    for (const [t, n] of Object.entries(raw.deck || {})) if (isPieceType(t)) R.deck[t] = clamp(finite(n, 0), 0, 99) | 0;
    if (!Object.values(R.deck).some((n) => n > 0)) R.deck = { ...KITS[R.kit].deck };
    R.relics = Array.isArray(raw.relics) ? raw.relics.filter((id) => RELICS[id]).slice(0, RELIC_IDS.length) : [];
    R.upgrades = Array.isArray(raw.upgrades) ? raw.upgrades.filter((id) => UPGRADES[id]).slice(0, UPGRADE_IDS.length) : [];
    R.dailyMods = Array.isArray(raw.dailyMods) ? raw.dailyMods.filter((id) => DAILY_MODS[id]) : R.dailyMods;
    R.heart.max = clamp(finite(raw.heart?.max, 100), 40, 500) | 0;
    R.heart.hp = clamp(finite(raw.heart?.hp, R.heart.max), 1, R.heart.max) | 0;
    R.score = clamp(finite(raw.score, 0), 0, 1e9) | 0;
    R.ledger = Array.isArray(raw.ledger) ? raw.ledger.filter((e) => e && typeof e === 'object').slice(0, 200).map((e) => ({ night: finite(e.night) | 0, won: !!e.won, score: finite(e.score) | 0, kills: finite(e.kills) | 0, heart: finite(e.heart) | 0, cracks: finite(e.cracks) | 0, shatters: finite(e.shatters) | 0, waves: finite(e.waves) | 0 })) : [];
    R.flags = raw.flags && typeof raw.flags === 'object' ? { ...raw.flags } : {};
    R.rngState = finite(raw.rngState, R.rngState) >>> 0;
    if (R.phase === 'dawn') {
      R.draft = raw.draft && Array.isArray(raw.draft.options) ? { night: R.night, options: raw.draft.options.filter(validOption).slice(0, 3), taken: finite(raw.draft.taken, -1) | 0 } : makeDraft(R);
      if (!R.draft.options.length) R.draft = makeDraft(R);
      R.fate = raw.fate && FATES[raw.fate.id] ? { id: raw.fate.id, night: R.night, name: FATES[raw.fate.id].name, text: FATES[raw.fate.id].text, take: FATES[raw.fate.id].take, taken: finite(raw.fate.taken, -1) | 0 } : null;
    }
    return R;
  } catch {
    return null;
  }
}

function validOption(o) {
  if (!o || typeof o !== 'object') return false;
  if (o.kind === 'piece') return isPieceType(o.id);
  if (o.kind === 'relic') return !!RELICS[o.id];
  if (o.kind === 'upgrade') return !!UPGRADES[o.id];
  return false;
}

/** Which kits, boards and ascensions a profile has earned. */
export function unlocks(profile) {
  const p = profile || {};
  const bestNight = finite(p.bestNight, 0);
  const wins = finite(p.wins, 0);
  const boardsWon = p.boardsWon && typeof p.boardsWon === 'object' ? p.boardsWon : {};
  const bosses = p.bosses && typeof p.bosses === 'object' ? p.bosses : {};
  return {
    kits: KIT_IDS.filter((id) => {
      const u = KITS[id].unlock;
      if (!u) return true;
      if (u === 'night4') return bestNight >= 4;
      if (u === 'night8') return bestNight >= 8;
      if (u === 'umbra') return !!bosses.umbra;
      return false;
    }),
    boards: Object.keys(BOARD_DEFS).filter((id) => {
      const u = BOARD_DEFS[id].unlock;
      if (!u) return true;
      if (u === 'night6') return bestNight >= 6;
      if (u === 'win') return wins > 0;
      if (u === 'cross-win') return !!boardsWon.cross;
      return false;
    }),
    ascension: wins > 0 ? clamp(finite(p.ascensionWon, 0) + 1, 1, MAX_ASCENSION) : 0,
  };
}

export { bossFor };
