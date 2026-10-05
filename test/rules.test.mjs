import test from 'node:test';
import assert from 'node:assert/strict';
import { placePoints, bombsWanted, buildRoster, rng, shuffle, hash32, BOT_NAMES, TABLE, PLAYER_COLORS } from '../game/rules.js';

test('place points by elimination order', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 11].map(placePoints), [10, 7, 5, 4, 3, 2, 1, 1]);
});

test('two bombs while seven or more are in, one below, none for a lone player', () => {
  assert.deepEqual([12, 8, 7, 6, 3, 2, 1, 0].map(bombsWanted), [2, 2, 2, 1, 1, 1, 0, 0]);
});

test('the roster: humans first, bots up to eight, none when there are eight humans', () => {
  const r = buildRoster(['a', 'b'], 42, (id) => 'Name ' + id);
  assert.equal(r.length, TABLE);
  assert.deepEqual(r.slice(0, 2).map((x) => x.id), ['a', 'b']);
  assert.equal(r[0].n, 'Name a');
  assert.deepEqual(r.slice(2).map((x) => x.id), ['bot1', 'bot2', 'bot3', 'bot4', 'bot5', 'bot6']);
  assert.ok(r.slice(2).every((x) => x.b === 1 && BOT_NAMES.includes(x.n)));
  assert.equal(new Set(r.map((x) => x.n)).size >= 7, true);
  assert.equal(new Set(r.map((x) => x.c)).size, TABLE, 'every seat has its own color');
  assert.ok(r.every((x) => x.c >= 0 && x.c < PLAYER_COLORS.length));
  const eight = buildRoster(Array.from({ length: 8 }, (_, i) => 'h' + i), 1, (id) => id);
  assert.equal(eight.length, 8);
  assert.ok(eight.every((x) => !x.b));
  const twelve = buildRoster(Array.from({ length: 12 }, (_, i) => 'h' + i), 1, (id) => id);
  assert.equal(twelve.length, 12);
  assert.equal(new Set(twelve.map((x) => x.c)).size, 12);
  assert.deepEqual(buildRoster(['a'], 9, () => 'x'), buildRoster(['a'], 9, () => 'x'), 'the same seed builds the same roster');
});

test('names are cleaned and cut', () => {
  const r = buildRoster(['a'], 1, () => '  A very very long player name \u0007 ');
  assert.ok(r[0].n.length <= 16);
  assert.ok(!/[\u0000-\u001f]/.test(r[0].n));
  assert.equal(buildRoster(['a'], 1, () => 42)[0].n, 'Player');
});

test('seeded random numbers repeat and stay in range', () => {
  const a = rng(7);
  const b = rng(7);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], rng(3)).sort(), [1, 2, 3, 4, 5]);
  assert.notEqual(hash32('a'), hash32('b'));
});
