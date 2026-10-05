import test from 'node:test';
import assert from 'node:assert/strict';
import { rng, buildRoster, ARC_MS, STUN_MS, IMMUNE_MS, FALL_MS, FIRST_DROP_MS, REDROP_MS, FUSE_MIN, FUSE_MAX, ROUND_CAP_MS, OVER_MS, BETWEEN_MS, FINAL_MS } from '../game/rules.js';
import { newMatch, tick, pass, aliveIds, isAlive, bombOf, finalRanking, awards, TICK_NONE, TICK_DIRTY, TICK_END, newPractice } from '../game/engine.js';

const ok = { status: () => 'ok', rand: rng(1) };
const make = (n = 8, rounds = 3, seed = 1, ctx = ok) => newMatch({ mid: 'm', by: 'h', roster: buildRoster([], seed, () => '', n), rounds, map: 'backyard' }, 0, rng(seed), ctx);
const ids = (g) => g.roster.map((r) => r.id);

/** Runs the clock to `to` in 50 ms ticks (the host's ticker) and returns g. */
function advance(g, from, to, ctx = ok) {
  for (let t = from; t < to; t += 50) tick(g, t, ctx);
  tick(g, to, ctx);
  return g;
}

test('a round opens with the bombs due 2 s in, two while 7+ are in', () => {
  const g = make(8);
  assert.equal(g.phase, 'play');
  assert.equal(g.rid, 'm.1');
  assert.deepEqual(g.drops, [FIRST_DROP_MS, FIRST_DROP_MS]);
  assert.equal(g.bombs.length, 0);
  assert.equal(make(6).drops.length, 1);
});

test('the bombs drop on two different players, with a hidden fuse of 12 to 22 s', () => {
  const g = make(8);
  assert.equal(tick(g, 1900, ok), TICK_NONE);
  assert.equal(tick(g, 2000, ok), TICK_DIRTY);
  assert.equal(g.bombs.length, 2);
  assert.notEqual(g.bombs[0].h, g.bombs[1].h);
  for (const b of g.bombs) {
    assert.ok(b.b - 2000 >= FUSE_MIN && b.b - 2000 <= FUSE_MAX);
    assert.equal(b.a, 2000 + FALL_MS);
    assert.equal(b.f, null);
  }
});

test('never the same first holder two rounds running (when avoidable)', () => {
  for (let seed = 1; seed < 40; seed++) {
    const c = { status: () => 'ok', rand: rng(seed) };
    const g = make(8, 3, seed, c);
    advance(g, 0, 2000, c);
    const first = g.first.slice();
    assert.equal(first.length, 2);
    g.phase = 'over';
    g.until = 0;
    tick(g, 3000, c); // -> between
    tick(g, 3000 + BETWEEN_MS, c); // -> round 2
    assert.equal(g.rid, 'm.2');
    advance(g, g.t0, g.t0 + 2000, c);
    for (const id of g.first) assert.ok(!first.includes(id), `seed ${seed}: ${id} held first twice`);
  }
});

function dropped(n = 8) {
  const g = make(n);
  tick(g, 2000, ok);
  return g;
}

test('passing: the holder tags someone free; the bomb flies 0.2 s, the new holder is stunned, the old one is immune', () => {
  const g = dropped(6);
  const b = g.bombs[0];
  const from = b.h;
  const to = ids(g).find((id) => id !== from);
  const t = 2000 + FALL_MS + 100;
  assert.equal(pass(g, b.k, to, t, ok), true);
  assert.equal(b.h, to);
  assert.equal(b.f, from);
  assert.equal(b.a, t + ARC_MS);
  assert.equal(g.stun[to], t + ARC_MS + STUN_MS);
  assert.equal(g.imm[from], t + IMMUNE_MS);
  assert.equal(g.st[from].p, 1);
  assert.equal(bombOf(g, from), null);
});

test('passing is refused: while the bomb falls or flies, to a bomb holder, to an immune player, to yourself, out of phase, with a bad bomb', () => {
  const g = dropped(8);
  const [b1, b2] = g.bombs;
  const free = ids(g).filter((id) => id !== b1.h && id !== b2.h);
  assert.equal(pass(g, b1.k, free[0], 2000 + FALL_MS - 1, ok), false, 'still falling');
  const t = 2000 + FALL_MS;
  assert.equal(pass(g, b1.k, b2.h, t, ok), false, 'target holds a bomb');
  assert.equal(pass(g, b1.k, b1.h, t, ok), false, 'to yourself');
  assert.equal(pass(g, 99, free[0], t, ok), false, 'no such bomb');
  assert.equal(pass(g, b1.k, 'nobody', t, ok), false, 'not in the match');
  assert.equal(pass(g, b1.k, free[0], t, ok), true);
  assert.equal(pass(g, b1.k, free[1], t + 50, ok), false, 'in the air');
  const old = b1.f;
  assert.equal(pass(g, b2.k, old, t + 100, ok), false, 'the one who just passed is immune');
  assert.equal(pass(g, b2.k, old, t + IMMUNE_MS + 10, ok), true, 'and then isn\'t');
  assert.equal(pass(g, b2.k, free[2], b2.b + 1, ok), false, 'too late: it has blown');
  assert.equal(pass(g, b2.k, free[2], t + 20, { status: () => 'away' }), false, 'away players can\'t be tagged');
  g.phase = 'over';
  assert.equal(pass(g, b2.k, free[2], t, ok), false);
});

test('a bomb blows at its deadline: the holder is out, everyone else gets +1, a new bomb drops 1.5 s later while 7+ are in', () => {
  const g = dropped(8);
  const first = g.bombs.slice().sort((a, b) => a.b - b.b)[0];
  const holder = first.h;
  for (const b of g.bombs) if (b !== first) b.b = Math.max(b.b, first.b + 30000); // keep the other one ticking
  advance(g, 2050, first.b);
  assert.equal(g.out.length, 1);
  assert.deepEqual(g.out[0], { id: holder, t: first.b, l: 0 });
  assert.equal(isAlive(g, holder), false);
  assert.equal(g.bombs.length, 1);
  for (const id of aliveIds(g)) assert.equal(g.rs[id], 1);
  assert.equal(g.rs[holder], 0);
  assert.equal(g.drops.length, 1, '7 players are still in: two bombs wanted');
  assert.equal(g.drops[0], first.b + REDROP_MS);
  advance(g, first.b + 50, first.b + REDROP_MS + 100);
  assert.equal(g.bombs.length, 2);
  assert.ok(!g.bombs.some((b) => b.h === holder));
});

test('with 6 or fewer in, one bomb at a time and no new one while one is ticking', () => {
  const g = dropped(6);
  assert.equal(g.bombs.length, 1);
  advance(g, 2050, g.bombs[0].b + 100);
  assert.equal(g.bombs.length, 0);
  assert.equal(g.drops.length, 1);
  advance(g, g.bombs[0] ? 0 : 0, 0);
});

test('last one standing wins the round: 10, 7, 5, 4, 3, 2, 1 points by elimination order, plus survival points', () => {
  const g = dropped(8);
  let t = 2000;
  const order = [];
  for (let i = 0; i < 7; i++) {
    // Run until the next bomb blows.
    const before = g.out.length;
    while (g.out.length === before && g.phase === 'play') {
      t += 50;
      tick(g, t, ok);
    }
    order.push(g.out[g.out.length - 1].id);
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.until, t + OVER_MS);
  const winner = aliveIds(g)[0];
  assert.equal(g.win, winner);
  // placement points: winner 10, then the last one out 7, ...
  const pts = [10, 7, 5, 4, 3, 2, 1, 1];
  const ranked = [winner, ...order.slice().reverse()];
  // survival points: every boom gave +1 to everyone still in
  const survival = (id) => g.out.filter((o) => o.id !== id && (ranked.indexOf(id) < ranked.indexOf(o.id))).length;
  ranked.forEach((id, place) => {
    assert.equal(g.rs[id], pts[place] + survival(id), `place ${place + 1}`);
    assert.equal(g.scores[id], g.rs[id]);
  });
  assert.deepEqual(g.pl.map((x) => x[0]), ranked);
});

test('a tie (several left when time runs out) shares the better place', () => {
  const g = dropped(4);
  for (const b of g.bombs) b.b = 10 * ROUND_CAP_MS; // nothing blows before the cap
  tick(g, ROUND_CAP_MS - 1, ok);
  assert.equal(g.phase, 'play');
  tick(g, ROUND_CAP_MS, ok);
  assert.equal(g.phase, 'over');
  assert.equal(g.out.length, 1, 'the cap blew the bomb');
  assert.equal(g.out[0].t, ROUND_CAP_MS);
  assert.equal(g.pl[0].length, 3, 'three survivors share first');
  for (const id of g.pl[0]) assert.equal(g.rs[id], 10 + 1, 'first place points plus the survival point');
  assert.equal(g.win, null);
  assert.equal(g.pl[1][0], g.out[0].id);
  assert.equal(g.rs[g.out[0].id], 4, 'the one who blew is 4th');
});

test('the screens run on the clock: over, between (4 s), the next round, and after the last round the final (8.5 s) then end', () => {
  const g = dropped(2);
  let t = 2000;
  while (g.phase === 'play') tick(g, (t += 50), ok);
  assert.equal(g.phase, 'over');
  assert.equal(tick(g, g.until - 1, ok), TICK_NONE);
  assert.equal(tick(g, g.until, ok), TICK_DIRTY);
  assert.equal(g.phase, 'between');
  const until = g.until;
  assert.equal(until - t >= BETWEEN_MS - 50, true);
  tick(g, until, ok);
  assert.equal(g.phase, 'play');
  assert.equal(g.rid, 'm.2');
  assert.equal(g.t0, until);
  assert.equal(g.bombs.length, 0);
  assert.deepEqual(g.out, []);
  assert.equal(g.imm && Object.keys(g.imm).length, 0);
  // finish rounds 2 and 3
  for (let r = 2; r <= 3; r++) {
    t = g.t0;
    while (g.phase === 'play') tick(g, (t += 50), ok);
    assert.equal(g.phase, 'over');
    tick(g, g.until, ok);
    if (r < 3) {
      assert.equal(g.phase, 'between');
      tick(g, g.until, ok);
    }
  }
  assert.equal(g.phase, 'final');
  const end = g.until;
  assert.equal(tick(g, end - 1, ok), TICK_NONE);
  assert.equal(tick(g, end, ok), TICK_END);
  assert.equal(finalRanking(g).length, 2);
});

test('a player who leaves hands their bomb to the nearest player, is out of the round and keeps their points', () => {
  const g = dropped(6);
  const b = g.bombs[0];
  const leaver = b.h;
  g.scores[leaver] = 12;
  const pos = { [leaver]: { x: 5, y: 5 } };
  const others = ids(g).filter((id) => id !== leaver);
  others.forEach((id, i) => (pos[id] = { x: 5 + (i + 1) * 3, y: 5 }));
  const ctx = { rand: rng(2), status: (id) => (id === leaver ? 'gone' : 'ok'), pos: (id) => pos[id] };
  tick(g, 2700, ctx);
  assert.equal(b.h, others[0], 'the nearest alive player has it');
  assert.equal(b.f, leaver);
  assert.ok(g.stun[others[0]] > 2700);
  assert.equal(g.imm[leaver], undefined);
  assert.equal(g.st[leaver].p, 0, 'a jump isn\'t a pass');
  assert.ok(g.gone.includes(leaver));
  assert.equal(g.out.at(-1).l, 1);
  assert.equal(g.scores[leaver], 12);
  assert.equal(isAlive(g, leaver), false);
});

test('a holder who goes away loses the bomb to someone who is here; away players are never given one', () => {
  const g = dropped(6);
  const b = g.bombs[0];
  const away = b.h;
  const sleeper = ids(g).find((id) => id !== away);
  const ctx = { rand: rng(2), status: (id) => (id === away || id === sleeper ? 'away' : 'ok') };
  tick(g, 2700, ctx);
  assert.notEqual(b.h, away);
  assert.notEqual(b.h, sleeper);
  assert.equal(isAlive(g, away), true, 'still in the round: their seat is held');
});

test('players who left in an earlier round stay out of later ones', () => {
  const g = dropped(5);
  const leaver = ids(g)[3];
  const ctx = { rand: rng(4), status: (id) => (id === leaver ? 'gone' : 'ok') };
  let t = 2050;
  while (g.phase === 'play') tick(g, (t += 50), ctx);
  tick(g, g.until, ctx);
  tick(g, g.until, ctx);
  assert.equal(g.rid, 'm.2');
  assert.equal(aliveIds(g).includes(leaver), false);
  assert.equal(aliveIds(g).length, 4);
});

test('when only one player is left in (everyone else gone) the round ends at once with that winner', () => {
  const g = make(3);
  const keep = ids(g)[0];
  const ctx = { rand: rng(1), status: (id) => (id === keep ? 'ok' : 'gone') };
  tick(g, 100, ctx);
  assert.equal(g.phase, 'over');
  assert.equal(g.win, keep);
});

test('final ranking: points, then this round, then less time holding, then seat; awards', () => {
  const g = make(4, 1);
  const [a, b, c, d] = ids(g);
  g.scores = { [a]: 5, [b]: 9, [c]: 9, [d]: 1 };
  g.rs = { [a]: 5, [b]: 2, [c]: 8, [d]: 1 };
  assert.deepEqual(finalRanking(g), [c, b, a, d]);
  g.rs[c] = 2;
  g.st[b].h = 5000;
  g.st[c].h = 1000;
  assert.deepEqual(finalRanking(g), [c, b, a, d]);
  g.st[c].h = 9000;
  assert.deepEqual(finalRanking(g), [b, c, a, d]);
  g.st[a].p = 4;
  g.st[b].p = 4;
  g.st[a].h = 700;
  g.st[b].h = 800;
  g.st[c].h = 900;
  g.st[d].h = 0;
  const w = awards(g);
  assert.deepEqual(w.potato, { id: a, n: 4 });
  assert.deepEqual(w.slippery, { id: d, ms: 0 });
  g.gone.push(a);
  assert.deepEqual(awards(g).potato, { id: b, n: 4 });
  g.st[a].p = 0;
  g.st[b].p = 0;
  assert.equal(awards(g).potato, null);
});

test('hold time adds up when a bomb moves and when it blows', () => {
  const g = dropped(6);
  const b = g.bombs[0];
  const from = b.h;
  const to = ids(g).find((id) => id !== from);
  pass(g, b.k, to, 5000, ok);
  assert.equal(g.st[from].h, 3000);
  advance(g, 5050, b.b);
  assert.equal(g.st[to].h, b.b - 5000);
});

test('the lobby practice bomb can be passed but never blows', () => {
  const roster = [{ id: 'me', n: 'You', b: 0, c: 0 }, { id: 'p1', n: 'A', b: 1, c: 1 }, { id: 'p2', n: 'B', b: 1, c: 2 }];
  const g = newPractice(roster, 'p1');
  assert.equal(pass(g, 0, 'me', 1000, null), true);
  assert.equal(pass(g, 0, 'p1', 1100, null), false, 'in the air');
  assert.equal(pass(g, 0, 'p1', 1000 + ARC_MS + 10, null), false, 'immune');
  assert.equal(pass(g, 0, 'p2', 1000 + ARC_MS + 10, null), true);
  assert.equal(pass(g, 0, 'me', 1e9, null), true, 'a year later it still hasn\'t blown');
});

test('a bomb that is already due is not handed to someone just before it blows', () => {
  const g = dropped(6);
  const b = g.bombs[0];
  const away = b.h;
  const ctx = { rand: rng(2), status: (id) => (id === away ? 'away' : 'ok') };
  tick(g, b.b + 10, ctx); // due and its holder is away: it blows on them, nobody else
  assert.equal(g.out.length, 1);
  assert.equal(g.out[0].id, away);
  const g2 = dropped(6);
  const b2 = g2.bombs[0];
  const leaver = b2.h;
  tick(g2, b2.b + 10, { rand: rng(2), status: (id) => (id === leaver ? 'gone' : 'ok') });
  assert.ok(g2.gone.includes(leaver));
  assert.equal(g2.out.filter((o) => !o.l).length, 0, 'nobody was blown up for the leaver\'s bomb');
  assert.equal(g2.bombs.some((x) => x.k === b2.k), false);
  assert.equal(g2.drops.length >= 1, true, 'a new bomb is on its way');
});
