// The balance harness: bots of three skills play the pure simulation across seeds and print the numbers the
// design is tuned against. No browser, no platform.
//
//   node scripts/balance.mjs                      standard nights 1, 6, 8, 12 for every bot (8 seeds)
//   node scripts/balance.mjs --seeds 4 --nights 1,6
//   node scripts/balance.mjs --runs               full twelve-night runs per bot: the survival curve
//   node scripts/balance.mjs --archetypes         four decks at night 8 (fence, furnace, prism fan, rotor sweep), 24 seeds
//   node scripts/balance.mjs --relics             each relic's effect on the colour bot at night 8, 24 paired seeds
//   node scripts/balance.mjs --heat               six beams on one mirror: time to crack; a Dawn's price
//   node scripts/balance.mjs --all
import { buildBoard } from '../game/sim/boards.js';
import { createNight, TICK, HEAT_RATE, COOL_RATE } from '../game/sim/night.js';
import { createRun, nightConfig, endNight, applyDraft, applyFate, nextNight, makeDraft, runMods } from '../game/sim/run.js';
import { makeBot, pickDraft } from '../game/sim/bots.js';
import { makeRng, hashString } from '../game/sim/rng.js';
import { RELIC_IDS, RELICS } from '../game/sim/relics.js';
import { traceBeams } from '../game/sim/trace.js';
import { baseMods } from '../game/sim/pieces.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const SEEDS = Number(flag('seeds', 8));
// --from N starts the seeds at N (several processes can share one long table: --from 1, --from 25, ...).
const FROM = Number(flag('from', 1));
// Archetypes and relics need more seeds than the night table to say anything (one seed is 4 points at 24).
const SEEDS_WIDE = Number(flag('seeds', 24));
/** 90% interval half-width of a survival share, in points. */
const ci = (p, n) => Math.round(164.5 * Math.sqrt(Math.max(p * (1 - p), 0.01) / Math.max(1, n)));
const NIGHTS = String(flag('nights', '1,6,8,12')).split(',').map(Number);
const BOTS = String(flag('bots', 'random,hill,colour')).split(',');
const all = args.includes('--all');
const board = buildBoard(String(flag('board', 'octagon')));
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Plays one night with a bot; returns what happened. */
function playNight(R, kind, seed, opts = {}) {
  const cfg = nightConfig(R, board, [{ id: 'bot', role: '' }]);
  if (opts.mods) Object.assign(cfg.mods, opts.mods);
  const N = createNight(cfg);
  const rng = makeRng(hashString(`bot:${kind}:${seed}:${R.night}`));
  const bot = makeBot(kind, N, 'bot', rng, opts.bot || {});
  bot.atDusk();
  N.command('bot', { op: 'wave' });
  const heats = [];
  let ticks = 0;
  while (N.S.phase !== 'done' && N.S.phase !== 'lost' && N.S.t < 1200) {
    N.tick();
    bot.during();
    N.drainEvents();
    if (++ticks % 30 === 0 && N.S.pieces.length) heats.push(avg(N.S.pieces.map((p) => p.heat)));
  }
  return { N, won: N.S.phase === 'done', heart: N.S.heart.hp, kills: N.S.stats.kills, score: N.S.stats.score, heat: avg(heats), dawns: N.S.stats.dawns, cracks: N.S.stats.cracks, shatters: N.S.stats.shatters, t: N.S.t, pieces: N.S.pieces.length, lostBy: N.S.lostBy };
}

/** A run fast-forwarded to `night` by the bot's drafting policy, Heart full: the standard test bed. */
function standardRun(kind, night, seed) {
  const R = createRun({ seed, kit: 'observer', boardId: board.id, now: 0 });
  const rng = makeRng(hashString(`draft:${kind}:${seed}`));
  for (let n = 1; n < night; n++) {
    R.phase = 'dawn';
    R.draft = makeDraft(R);
    applyDraft(R, pickDraft(kind, R.draft.options, rng, R.deck));
    nextNight(R);
  }
  R.heart.hp = R.heart.max;
  return R;
}

function nightsTable() {
  console.log(`\nStandard nights (${SEEDS} seeds, deck = Observer + drafts by the bot, Heart full). Targets: n1 random >= 70%; n6 hill >= 70%, random <= 25%; n12 colour 30-45%, hill <= 15%.`);
  console.log('night  bot      survive  heart  kills  heat%  cracks  dawns  s/night');
  for (const night of NIGHTS) {
    for (const kind of BOTS) {
      const rows = [];
      const t0 = Date.now();
      for (let s = FROM; s < FROM + SEEDS; s++) rows.push(playNight(standardRun(kind, night, s), kind, s));
      const won = rows.filter((r) => r.won).length;
      console.log(`${String(night).padStart(5)}  ${kind.padEnd(8)} ${pct(won, rows.length).padStart(7)}  ${avg(rows.map((r) => r.heart)).toFixed(0).padStart(5)}  ${avg(rows.map((r) => r.kills)).toFixed(0).padStart(5)}  ${avg(rows.map((r) => r.heat)).toFixed(0).padStart(5)}  ${avg(rows.map((r) => r.cracks)).toFixed(1).padStart(6)}  ${avg(rows.map((r) => r.dawns)).toFixed(1).padStart(5)}  ${((Date.now() - t0) / rows.length / 1000).toFixed(1).padStart(7)}`);
    }
  }
}

function runsTable() {
  console.log(`\nFull runs (${SEEDS} seeds per bot): share of runs alive after each night.`);
  const nights = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  console.log('bot      ' + nights.map((n) => String(n).padStart(4)).join('') + '   wins  score');
  for (const kind of BOTS) {
    const alive = new Array(13).fill(0);
    const scores = [];
    for (let s = 1; s <= SEEDS; s++) {
      const R = createRun({ seed: s * 7919, kit: 'observer', boardId: board.id, now: 0 });
      const rng = makeRng(hashString(`run:${kind}:${s}`));
      while (R.phase === 'dusk' && R.night <= 12) {
        const res = playNight(R, kind, s);
        endNight(R, res.N, 0);
        if (R.phase === 'lost') break;
        alive[R.night]++;
        if (R.draft) applyDraft(R, pickDraft(kind, R.draft.options, rng, R.deck));
        if (R.fate) applyFate(R, rng.chance(kind === 'colour' ? 0.5 : 0.3));
        nextNight(R);
      }
      scores.push(R.score);
    }
    console.log(`${kind.padEnd(8)} ` + nights.map((n) => pct(alive[n], SEEDS).padStart(4)).join('') + `  ${pct(alive[12], SEEDS).padStart(5)}  ${avg(scores).toFixed(0)}`);
  }
}

// Each archetype is the Observer kit plus six pieces of its own (the same count of glass for every one), played by
// the colour bot: a fence of spread light, a furnace of lenses, a prism fan with filters, a swing of Rotors.
const ARCHETYPES = {
  fence: { concave: 2, splitter: 2, mirror: 2 },
  furnace: { lens: 2, mirror: 2, heatsink: 1, splitter: 1 },
  'prism fan': { prism: 1, 'filter-r': 1, 'filter-g': 1, 'filter-b': 1, mirror: 2 },
  'rotor sweep': { rotor: 3, mirror: 2, splitter: 1 },
};
const KIT = { mirror: 4, splitter: 1, prism: 1, lens: 1 };

function archetypesTable() {
  const kind = String(flag('bot', 'colour'));
  console.log(`\nArchetypes at night 8 (${kind} bot, ${SEEDS_WIDE} seeds, Observer kit + six pieces each). Target: within 15 points of each other.`);
  const rates = [];
  for (const [name, extra] of Object.entries(ARCHETYPES)) {
    const rows = [];
    for (let s = 1; s <= SEEDS_WIDE; s++) {
      const R = createRun({ seed: s * 31, kit: 'observer', boardId: board.id, now: 0 });
      R.night = 8;
      R.deck = { ...KIT };
      for (const [t, n] of Object.entries(extra)) R.deck[t] = (R.deck[t] || 0) + n;
      rows.push(playNight(R, kind, s));
    }
    const p = rows.filter((r) => r.won).length / rows.length;
    rates.push(p);
    console.log(`${name.padEnd(12)} survive ${pct(p * rows.length, rows.length).padStart(4)} ±${String(ci(p, rows.length)).padStart(2)}  heart ${avg(rows.map((r) => r.heart)).toFixed(0).padStart(3)}  kills ${avg(rows.map((r) => r.kills)).toFixed(0).padStart(2)}  heat ${avg(rows.map((r) => r.heat)).toFixed(0)}%  cracks ${avg(rows.map((r) => r.cracks)).toFixed(1)}`);
  }
  console.log(`spread ${Math.round(100 * (Math.max(...rates) - Math.min(...rates)))} points`);
}

function relicsTable() {
  const n = SEEDS_WIDE;
  console.log(`\nRelics: colour bot at night 8, standard deck, each relic alone (${n} paired seeds: the same nights with and without it). Target: +15 / -10 at most.`);
  const base = [];
  for (let s = 1; s <= n; s++) base.push(playNight(standardRun('colour', 8, s), 'colour', s).won ? 1 : 0);
  const baseRate = (100 * base.reduce((a, b) => a + b, 0)) / n;
  console.log(`baseline ${baseRate.toFixed(0)}%`);
  const outliers = [];
  for (const id of RELIC_IDS) {
    const rows = [];
    for (let s = 1; s <= n; s++) {
      const R = standardRun('colour', 8, s);
      if (!R.relics.includes(id)) R.relics.push(id);
      if (RELICS[id].heal) {
        R.heart.max += RELICS[id].heal;
        R.heart.hp = R.heart.max;
      }
      rows.push(playNight(R, 'colour', s).won ? 1 : 0);
    }
    const rate = (100 * rows.reduce((a, b) => a + b, 0)) / n;
    const d = rate - baseRate;
    // Paired difference: its standard error comes from the seeds whose outcome the relic changed.
    const diffs = rows.map((v, i) => v - base[i]);
    const md = diffs.reduce((a, b) => a + b, 0) / n;
    const se = 100 * Math.sqrt(diffs.reduce((a, b) => a + (b - md) ** 2, 0) / Math.max(1, n - 1) / n);
    const mark = (d > 15 || d < -10) && Math.abs(d) > 1.65 * se ? '  OUTLIER' : '';
    if (mark) outliers.push(id);
    const info = id === 'second-sight' ? '  (information: the bot re-plans at every break anyway)' : '';
    console.log(`${id.padEnd(18)} ${rate.toFixed(0).padStart(4)}%  ${((d >= 0 ? '+' : '') + d.toFixed(0)).padStart(4)}  ±${(1.65 * se).toFixed(0).padStart(2)}${mark}${info}`);
  }
  console.log(outliers.length ? `outliers: ${outliers.join(', ')}` : 'no outliers beyond the band and the noise');
}

function heatCheck() {
  console.log('\nHeat: one mirror under n beams of 100 (steady state and time to crack).');
  const mods = baseMods();
  for (const n of [1, 2, 3, 6]) {
    const absorbed = n * 100 * 0.07 * HEAT_RATE * mods.heatRate;
    const steady = (absorbed / mods.cooling - 1) / COOL_RATE;
    let H = 0;
    let t = 0;
    while (H < 100 && t < 120) {
      H += (absorbed - (H * COOL_RATE + 1) * mods.cooling) * TICK;
      t += TICK;
    }
    console.log(`  ${n} beam(s): steady ${steady.toFixed(0)}%, crack ${H >= 100 ? `at ${t.toFixed(1)} s` : 'never'}`);
  }
  // A Dawn: the meter holds 40; a full 100 beam into the Heart charges 1/s, so a Dawn is 40 s of one beam.
  const lamps = [{ x: board.lamps[0].x, y: board.lamps[0].y, angle: 0, power: 100, radius: 22 }];
  const tr = traceBeams({ board, pieces: [], lamps });
  console.log(`  Dawn: a ${tr.heart[0].toFixed(0)}-power beam into the Heart fills the meter in ${(40 / (tr.heart[0] / 100)).toFixed(0)} s (about one wave of burning).`);
}

if (args.includes('--heat') || all) heatCheck();
if (args.includes('--archetypes') || all) archetypesTable();
if (args.includes('--relics') || all) relicsTable();
if (args.includes('--runs') || all) runsTable();
if (!args.some((a) => ['--heat', '--archetypes', '--relics', '--runs'].includes(a)) || all) nightsTable();
