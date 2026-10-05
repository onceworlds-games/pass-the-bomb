// How a page reads the host's bot snapshots, and how a new host picks the bots up where the old one left them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, Server, clock, frames } from './harness.mjs';
import { rng, buildRoster, STEP } from '../game/rules.js';
import { mapOf } from '../game/maps.js';
import { newMatch } from '../game/engine.js';
import { createBotWorld, placeBots, adoptBots, stepBots, snapshotBots } from '../game/botworld.js';

installGlobals();
const { createNet } = await import('../game/net.js');

function netFor(room) {
  return createNet(room, { now: () => clock.T }, { posOf: () => null });
}

test('a page draws a bot between the two snapshots around now, and a little past the newest', () => {
  const server = new Server({ latency: 0 });
  const room = server.join('p2', 'Bob');
  const net = netFor(room);
  const out = {};
  assert.equal(net.botAt(0, 'm.1', 1000, out), false, 'no snapshot yet');
  room.emit('state', 'b', { rid: 'm.1', t: 1000, p: [[1, 1, 2, 0, 0], 0] }, 'p1');
  room.emit('state', 'b', { rid: 'm.1', t: 1100, p: [[3, 1, 2, 0, 1], 0] }, 'p1');
  assert.equal(net.botAt(0, 'm.1', 1050, out), true);
  assert.ok(Math.abs(out.x - 2) < 1e-9 && out.y === 1);
  assert.equal(out.dash, true);
  net.botAt(0, 'm.1', 1100, out);
  assert.ok(Math.abs(out.x - 3) < 1e-9);
  net.botAt(0, 'm.1', 1180, out);
  assert.ok(out.x > 3 && out.x < 3.2, 'a little past the newest, by its speed');
  net.botAt(0, 'm.1', 5000, out);
  assert.ok(out.x <= 3 + 2 * 0.15 + 1e-9, 'never guessed more than 150 ms ahead');
  assert.equal(net.botAt(1, 'm.1', 1050, out), false, 'a bot that is out has no position');
  assert.equal(net.botAt(0, 'm.2', 1050, out), false, 'snapshots of another round are not used');
  room.emit('state', 'b', { rid: 'm.1', t: 1200, p: [[20, 12, 0, 0, 0], 0] }, 'p1');
  net.botAt(0, 'm.1', 1150, out);
  assert.equal(out.x, 20, 'a jump of several units is a teleport, not a slide');
});

test('malformed snapshots and records are ignored, not drawn', () => {
  const server = new Server({ latency: 0 });
  const room = server.join('p2', 'Bob');
  const net = netFor(room);
  const out = {};
  for (const bad of [null, 5, 'x', {}, { rid: 1, t: 1, p: [] }, { rid: 'm.1', t: NaN, p: [] }, { rid: 'm.1', t: 1, p: 'no' }]) room.emit('state', 'b', bad, 'p1');
  room.emit('state', 'b', { rid: 'm.1', t: 10, p: [[NaN, 1, 1, 1, 0], ['a', 1, 1, 1], [1, 2, 3]] }, 'p1');
  for (const i of [0, 1, 2]) assert.equal(net.botAt(i, 'm.1', 10, out), false);
  assert.equal(net.validG(), null);
});

test('a new host puts the bots back where the old host last had them', () => {
  const rand = rng(5);
  const roster = buildRoster(['h1'], 3, () => 'H', 8);
  const ctx = { rand, status: () => 'ok' };
  const g = newMatch({ mid: 'm', by: 'old', roster, rounds: 3, map: 'beach' }, 0, rand, ctx);
  const map = mapOf('beach');
  const old = createBotWorld(rng(1));
  placeBots(old, g, map);
  for (let i = 0; i < 90; i++) stepBots(old, g, map, STEP, i * 17, [{ id: 'h1', x: 12, y: 12, vx: 0, vy: 0, dash: false, away: false }]);
  const snap = { rid: g.rid, t: 1500, p: snapshotBots(old, g) };
  const fresh = createBotWorld(rng(2));
  adoptBots(fresh, g, map, snap);
  let i = 0;
  for (const r of g.roster) {
    if (!r.b) continue;
    const e = fresh.bots.get(r.id);
    const s = snap.p[i++];
    assert.ok(Math.abs(e.ch.x - s[0]) < 1e-9 && Math.abs(e.ch.y - s[1]) < 1e-9, `${r.id} is back where it was`);
  }
  const other = createBotWorld(rng(3));
  adoptBots(other, g, map, { ...snap, rid: 'old.round' });
  const first = g.roster.find((r) => r.b);
  assert.notDeepEqual([other.bots.get(first.id).ch.x, other.bots.get(first.id).ch.y], [snap.p[0][0], snap.p[0][1]], 'a snapshot of another round is not used: the bots start at their spots');
  void frames;
});
