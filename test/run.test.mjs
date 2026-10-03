import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, runMods, nightConfig, endNight, makeDraft, applyDraft, fateFor, applyFate, nextNight, goEndless, parseRun, unlocks, KITS, moonFor, dailySetup, dailyDay, MAX_ASCENSION } from '../game/sim/run.js';
import { RELICS, RELIC_IDS, UPGRADES, FATES, FATE_IDS } from '../game/sim/relics.js';
import { buildBoard } from '../game/sim/boards.js';
import { createNight } from '../game/sim/night.js';
import { baseMods } from '../game/sim/pieces.js';

const board = buildBoard('octagon');

test('every relic, upgrade and Fate applies without throwing and changes something', () => {
  for (const id of RELIC_IDS) {
    const m = baseMods();
    const before = JSON.stringify(m);
    RELICS[id].apply(m);
    assert.notEqual(JSON.stringify(m), before, id);
    for (const v of Object.values(m)) if (typeof v === 'number') assert.ok(Number.isFinite(v), id);
  }
  assert.equal(RELIC_IDS.length, 24);
  for (const id of Object.keys(UPGRADES)) {
    const m = baseMods();
    const before = JSON.stringify(m);
    UPGRADES[id].apply(m);
    assert.notEqual(JSON.stringify(m), before, id);
  }
  for (const id of FATE_IDS) {
    const R = createRun({ seed: 3 });
    R.night = 5;
    R.fate = { id, night: 5, taken: -1 };
    assert.equal(applyFate(R, true), true);
    assert.ok(R.heart.hp >= 1 && R.heart.hp <= R.heart.max);
  }
});

test('a draft always offers at least one piece and at most three choices; taking it grows the deck', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const R = createRun({ seed });
    R.night = 1 + (seed % 12);
    const d = makeDraft(R);
    assert.ok(d.options.length >= 2 && d.options.length <= 3);
    assert.ok(d.options.some((o) => o.kind === 'piece'));
    const total = Object.values(R.deck).reduce((a, b) => a + b, 0);
    const i = d.options.findIndex((o) => o.kind === 'piece');
    R.draft = d;
    assert.equal(applyDraft(R, i), true);
    assert.ok(Object.values(R.deck).reduce((a, b) => a + b, 0) > total);
    assert.equal(applyDraft(R, 0), false);
  }
});

test('a run goes dusk -> night -> dawn -> next night; twelve nights win; Endless continues', () => {
  const R = createRun({ seed: 5, kit: 'observer' });
  for (let n = 1; n <= 12; n++) {
    assert.equal(R.night, n);
    assert.equal(R.phase, 'dusk');
    const N = createNight(nightConfig(R, board, [{ id: 'p', role: 'seer' }]));
    N.S.phase = 'done';
    N.S.stats.score = 100;
    endNight(R, N, 0);
    assert.equal(R.phase, 'dawn');
    assert.ok(R.draft && R.draft.options.length);
    applyDraft(R, 0);
    if (R.fate) applyFate(R, false);
    nextNight(R);
  }
  assert.equal(R.phase, 'won');
  assert.equal(R.score, 1200);
  goEndless(R);
  assert.equal(R.night, 13);
  assert.equal(R.phase, 'dusk');
  const N = createNight(nightConfig(R, board, [{ id: 'p' }]));
  N.S.phase = 'lost';
  endNight(R, N, 0);
  assert.equal(R.phase, 'lost');
});

test('Fates come on nights 2, 5, 7 and 10 and are never repeated', () => {
  const R = createRun({ seed: 9 });
  const seen = new Set();
  for (let n = 1; n <= 12; n++) {
    R.night = n;
    const f = fateFor(R);
    if ([2, 5, 7, 10].includes(n)) {
      assert.ok(f, `night ${n}`);
      assert.ok(!seen.has(f.id));
      seen.add(f.id);
      R.fate = f;
      applyFate(R, false);
    } else assert.equal(f, null);
  }
});

test('mods fold kit, relics, upgrades, ascension and roles together', () => {
  const R = createRun({ seed: 2, kit: 'smith', ascension: 8 });
  R.relics.push('lamp-oil', 'deep-well');
  R.upgrades.push('quartz');
  const m = runMods(R, ['seer', 'alchemist']);
  assert.equal(m.focusCost, 0.7);
  assert.ok(Math.abs(m.lampPower - 1.15) < 1e-9);
  assert.equal(m.focusMax, 150);
  assert.equal(m.focusMin, 2);
  assert.equal(m.forecastAll, true);
  assert.equal(m.colourDamage, 1.2);
  assert.equal(m.focusRegen, 6);
  assert.equal(m.duskCap, 45);
  assert.equal(m.heartHp, 100); // the run's Heart max wins over the ascension floor until it is lowered
});

test('saves parse defensively: missing, empty, corrupt, older and newer versions', () => {
  assert.equal(parseRun(null), null);
  assert.equal(parseRun({}), null);
  assert.equal(parseRun({ v: 0, night: 3 }), null);
  assert.equal(parseRun({ v: 99 }), null);
  assert.equal(parseRun('garbage'), null);
  const good = createRun({ seed: 42, kit: 'alchemist', boardId: 'cross' });
  good.night = 7;
  good.phase = 'dawn';
  good.draft = makeDraft(good);
  good.relics.push('anvil', 'bogus');
  good.deck.mirror = 1e9;
  good.heart.hp = -5;
  const back = parseRun(JSON.parse(JSON.stringify(good)));
  assert.ok(back);
  assert.equal(back.night, 7);
  assert.equal(back.kit, 'alchemist');
  assert.equal(back.boardId, 'cross');
  assert.deepEqual(back.relics, ['anvil']);
  assert.equal(back.deck.mirror, 99);
  assert.ok(back.heart.hp >= 1);
  assert.equal(back.phase, 'dawn');
  assert.ok(back.draft.options.length >= 2);
  const mid = parseRun({ v: 1, seed: 1, phase: 'night', night: 4, deck: { mirror: 2 } });
  assert.equal(mid.phase, 'dusk');
  const odd = parseRun({ v: 1, seed: 'abc', kit: 'nope', boardId: 'moon', night: 'x', deck: 'no', relics: 'no', heart: null });
  assert.ok(odd && odd.night === 1 && KITS[odd.kit] && odd.boardId === 'octagon');
});

test('unlocks follow the profile; the moon cycles; the daily is the same for everyone that day', () => {
  const none = unlocks(null);
  assert.deepEqual(none.kits, ['observer']);
  assert.deepEqual(none.boards, ['octagon']);
  assert.equal(none.ascension, 0);
  const veteran = unlocks({ bestNight: 9, wins: 2, bosses: { umbra: 1 }, boardsWon: { cross: 1 }, ascensionWon: 3 });
  assert.equal(veteran.kits.length, 4);
  assert.equal(veteran.boards.length, 4);
  assert.equal(veteran.ascension, 4);
  assert.ok(unlocks({ wins: 1, ascensionWon: 99 }).ascension <= MAX_ASCENSION);
  const R = createRun({ seed: 1 });
  const names = new Set();
  for (let n = 1; n <= 8; n++) {
    R.night = n;
    const m = moonFor(R);
    assert.ok(m.f >= 0.6 && m.f <= 1.1);
    names.add(m.name);
  }
  assert.equal(names.size, 8);
  const day = dailyDay(1_700_000_000_000);
  assert.deepEqual(dailySetup(day), dailySetup(day));
  assert.equal(dailySetup(day).mods.length, 2);
  const D = createRun({ seed: 123, daily: day });
  assert.equal(D.seed, dailySetup(day).seed);
  assert.equal(D.kit, 'observer');
});
