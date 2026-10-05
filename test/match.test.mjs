import test from 'node:test';
import assert from 'node:assert/strict';
import { runMatch } from './helpers.mjs';
import { finalRanking, awards } from '../game/engine.js';
import { MAP_IDS } from '../game/rules.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 7919);

test('a whole bots-only match ends with a ranking of everyone, over 20 seeds', () => {
  const lens = [];
  let passes = 0;
  for (const seed of SEEDS) {
    const map = MAP_IDS[seed % MAP_IDS.length];
    const { g, rounds, ended, passes: p } = runMatch({ seed, players: 8, rounds: 3, map });
    assert.ok(ended, `seed ${seed}: the match never ended`);
    assert.equal(g.n, 3, `seed ${seed}: expected 3 rounds`);
    assert.equal(rounds.length, 3);
    assert.equal(g.phase, 'final');
    const ranking = finalRanking(g);
    assert.equal(ranking.length, 8);
    assert.equal(new Set(ranking).size, 8);
    for (const r of rounds) {
      assert.equal(r.alive <= 1, true);
      assert.ok(r.win, `seed ${seed}: a round ended without one winner`);
      const seen = r.pl.flat();
      assert.equal(seen.length, 8, `seed ${seed}: round placements must list everyone once`);
      assert.equal(new Set(seen).size, 8);
      assert.ok(r.ms >= 5000 && r.ms <= 180000, `round length ${r.ms}`);
      lens.push(r.ms);
    }
    // Scores are the sum of every round's points.
    const total = Object.values(g.scores).reduce((a, b) => a + b, 0);
    assert.ok(total > 0);
    const a = awards(g);
    assert.ok(a.slippery);
    passes += p;
  }
  assert.ok(passes > 20 * 3, `bots barely passed the bomb (${passes})`);
  lens.sort((a, b) => a - b);
  console.log(`rounds: ${lens.length}, length min ${lens[0] / 1000}s median ${lens[lens.length >> 1] / 1000}s max ${lens[lens.length - 1] / 1000}s, passes ${passes}`);
});

test('matches of 1, 3 and 5 rounds, 2 to 12 players, on every map', () => {
  let n = 0;
  for (const map of MAP_IDS) {
    for (const rounds of [1, 3, 5]) {
      for (const players of [2, 5, 8, 12]) {
        const seed = 77 + n++;
        const { g, ended } = runMatch({ seed, players, rounds, map });
        assert.ok(ended, `${map} ${rounds} rounds ${players} players: never ended`);
        assert.equal(g.n, rounds);
        assert.equal(finalRanking(g).length, players);
      }
    }
  }
});

test('the same seed plays the same match', () => {
  const a = runMatch({ seed: 5, players: 8, rounds: 1, check: false });
  const b = runMatch({ seed: 5, players: 8, rounds: 1, check: false });
  assert.equal(a.steps, b.steps);
  assert.deepEqual(a.g.scores, b.g.scores);
});
