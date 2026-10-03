import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, CELL } from '../game/sim/boards.js';
import { createNight, TICK } from '../game/sim/night.js';
import { makeRng } from '../game/sim/rng.js';
import { PIECE_IDS, HEAT_CAP } from '../game/sim/pieces.js';
import { MAX_SHADES } from '../game/sim/shades.js';

const board = buildBoard('octagon');
const deck = { mirror: 6, splitter: 2, prism: 1, lens: 2, 'filter-r': 1, combiner: 1, crystal: 1, rotor: 1, shutter: 1, heatsink: 1, black: 1, concave: 1 };
const mk = (over = {}) => createNight({ seed: 11, night: 3, board, deck, players: [{ id: 'a' }, { id: 'b', role: 'smith' }], heart: { hp: 100, max: 100 }, ...over });

test('commands are validated: bad cells, unknown types, occupied cells, empty tray, Focus', () => {
  const N = mk();
  assert.equal(N.command('a', { op: 'place', type: 'mirror', c: NaN, r: 2 }).ok, false);
  assert.equal(N.command('a', { op: 'place', type: 'mirror', c: 10, r: 6 }).ok, false); // the Heart
  assert.equal(N.command('a', { op: 'place', type: 'mirror', c: 0, r: 0 }).ok, false); // the dark
  assert.equal(N.command('a', { op: 'place', type: 'laser', c: 5, r: 5 }).ok, false);
  assert.equal(N.command('a', { op: 'place', type: 'mirror', c: 5, r: 5, angle: 'x' }).ok, true);
  assert.equal(N.command('a', { op: 'place', type: 'mirror', c: 5, r: 5 }).ok, false);
  assert.equal(N.command('zz', { op: 'place', type: 'mirror', c: 6, r: 5 }).ok, false);
  assert.equal(N.command('a', { op: 'nope' }).ok, false);
  assert.equal(N.command('a', null).ok, false);
  assert.equal(N.command('a', { op: 'place', type: 'prism', c: 6, r: 5 }).ok, true);
  assert.equal(N.command('a', { op: 'place', type: 'prism', c: 7, r: 5 }).ok, false); // only one prism
  assert.equal(N.command('a', { op: 'sell', id: 2 }).ok, true);
  assert.equal(N.command('a', { op: 'place', type: 'prism', c: 7, r: 5 }).ok, true);
  // During a wave Focus is spent and runs out.
  N.command('a', { op: 'wave' });
  const pl = N.player('a');
  pl.focus = 12;
  assert.equal(N.command('a', { op: 'place', type: 'mirror', c: 8, r: 5 }).ok, true);
  assert.equal(N.command('a', { op: 'place', type: 'mirror', c: 9, r: 5 }).ok, false);
  const ev = N.drainEvents();
  assert.ok(ev.some((e) => e.k === 'refuse' && e.reason === 'focus'));
  // A Smith pays 30% less.
  const sm = N.player('b');
  sm.focus = 8;
  assert.equal(N.command('b', { op: 'place', type: 'mirror', c: 9, r: 5 }).ok, false);
  sm.focus = 10;
  assert.equal(N.command('b', { op: 'place', type: 'mirror', c: 9, r: 5 }).ok, true);
});

test('rotation snaps to 5 degrees and costs one Focus per 15; fixed pieces refuse', () => {
  const N = mk();
  const r = N.command('a', { op: 'place', type: 'mirror', c: 5, r: 5, angle: 0 });
  N.command('a', { op: 'place', type: 'black', c: 6, r: 5 });
  N.command('a', { op: 'wave' });
  N.player('a').focus = 50;
  assert.equal(N.command('a', { op: 'rotate', id: r.id, angle: 47 }).ok, true);
  assert.equal(N.pieceById(r.id).angle, 45);
  assert.ok(Math.abs(N.player('a').focus - 47) < 1e-6);
  assert.equal(N.command('a', { op: 'rotate', id: 2, angle: 90 }).ok, false);
});

test('the same seed and commands give the same night, tick for tick', () => {
  const run = () => {
    const N = mk();
    N.command('a', { op: 'place', type: 'mirror', c: 4, r: 6, angle: 45 });
    N.command('a', { op: 'place', type: 'splitter', c: 7, r: 6, angle: 135 });
    N.command('a', { op: 'place', type: 'prism', c: 4, r: 9, angle: 0 });
    N.command('a', { op: 'wave' });
    const log = [];
    for (let i = 0; i < 30 * 90; i++) {
      N.tick();
      if (i % 90 === 0) log.push(JSON.stringify([N.exportMeta(), N.exportShades(), N.exportHeat()]));
      if (N.S.phase === 'break') N.command('b', { op: 'wave' });
    }
    return log.join('|');
  };
  assert.equal(run(), run());
});

test('six beams on one mirror crack it in under 20 s; one beam never does', () => {
  const hot = createNight({ seed: 1, night: 1, board, deck: { mirror: 1 }, players: [{ id: 'a' }], heart: { hp: 100, max: 100 } });
  // Six Lamps at 100 all aimed at one mirror.
  const target = { x: 5.5 * CELL, y: 6.5 * CELL };
  hot.S.lamps.length = 0;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = target.x + Math.cos(a) * 120;
    const y = target.y + Math.sin(a) * 120;
    hot.S.lamps.push({ i, x, y, angle: (Math.atan2(target.y - y, target.x - x) * 180) / Math.PI, target: 0, radius: 2, base: 100, smother: 0, power: 0 });
    hot.S.lamps[i].target = hot.S.lamps[i].angle;
  }
  hot.mods.breathLow = hot.mods.breathHigh = 1;
  hot.command('a', { op: 'place', type: 'mirror', c: 5, r: 6, angle: 90 });
  let t = 0;
  while (!hot.S.pieces[0].cracked && t < 60) {
    hot.tick();
    t += TICK;
  }
  assert.ok(hot.S.pieces[0].cracked, 'never cracked');
  assert.ok(t < 20, `cracked at ${t}`);
  const cool = createNight({ seed: 1, night: 1, board, deck: { mirror: 1 }, players: [{ id: 'a' }], heart: { hp: 100, max: 100 } });
  cool.mods.breathLow = cool.mods.breathHigh = 1;
  cool.command('a', { op: 'place', type: 'mirror', c: 5, r: 6, angle: 90 });
  for (let i = 0; i < 30 * 120; i++) cool.tick();
  assert.ok(!cool.S.pieces[0].cracked);
  assert.ok(cool.S.pieces[0].heat < HEAT_CAP * 0.8);
});

test('a night plays out: waves spawn, Shades die or reach the Heart, the phase ends', () => {
  const N = mk({ night: 2 });
  N.command('a', { op: 'place', type: 'mirror', c: 4, r: 6, angle: 45 });
  N.command('a', { op: 'wave' });
  let spawns = 0;
  let steps = 0;
  while (N.S.phase !== 'done' && N.S.phase !== 'lost' && steps++ < 30 * 900) {
    N.tick();
    for (const e of N.drainEvents()) if (e.k === 'spawn') spawns++;
    if (N.S.phase === 'break') N.command('a', { op: 'wave' });
  }
  assert.ok(spawns > 5);
  assert.ok(['done', 'lost'].includes(N.S.phase));
  assert.ok(N.S.stats.kills + N.S.stats.heartHits >= spawns - 2);
});

test('fuzz: random commands and 20,000 ticks never throw, make NaN, or let anything leave the world', () => {
  const rng = makeRng(99);
  const N = mk({ night: 6 });
  const ops = ['place', 'move', 'rotate', 'sell', 'lamp', 'flare', 'dawn', 'surge', 'wave'];
  for (let i = 0; i < 20000; i++) {
    if (i % 7 === 0) {
      const op = rng.pick(ops);
      const cmd = { op, type: rng.pick([...PIECE_IDS, 'junk']), c: rng.int(-3, 24), r: rng.int(-3, 16), angle: rng.pick([NaN, Infinity, -1e9, 33, 90]), id: rng.int(0, 20), x: rng.range(-9999, 9999), y: rng.range(-1e6, 1e6), i: rng.int(-1, 3) };
      const res = N.command(rng.pick(['a', 'b', 'nobody']), cmd);
      assert.ok(typeof res.ok === 'boolean');
    }
    N.tick();
    N.drainEvents();
    if (N.S.phase === 'lost') break;
  }
  assert.ok(Number.isFinite(N.S.t));
  assert.ok(N.S.heart.hp >= 0 && N.S.heart.hp <= 100);
  for (const pl of ['a', 'b']) assert.ok(N.player(pl).focus >= 0 && N.player(pl).focus <= 100);
  for (const s of N.S.shades) {
    assert.ok(Number.isFinite(s.x + s.y + s.hp));
    assert.ok(s.x >= -CELL * 2 && s.x <= board.w + CELL * 2 && s.y >= -CELL * 2 && s.y <= board.h + CELL * 2);
  }
  assert.ok(N.S.shades.length <= MAX_SHADES + 40);
  for (const p of N.S.pieces) assert.ok(p.heat >= 0 && p.heat <= HEAT_CAP * 1.2 && Number.isFinite(p.angle));
  assert.ok(N.S.stats.score < 1e9);
});

test('export and import round-trip the night, so a reload or a new host continues it', () => {
  const N = mk();
  N.command('a', { op: 'place', type: 'mirror', c: 4, r: 6, angle: 45 });
  N.command('a', { op: 'place', type: 'crystal', c: 6, r: 6, angle: 0 });
  N.command('a', { op: 'wave' });
  for (let i = 0; i < 30 * 25; i++) N.tick();
  const pieces = JSON.parse(JSON.stringify(N.exportPieces()));
  const meta = JSON.parse(JSON.stringify(N.exportMeta()));
  const shades = JSON.parse(JSON.stringify(N.exportShades()));
  const heat = JSON.parse(JSON.stringify(N.exportHeat()));
  assert.ok(JSON.stringify(pieces).length < 16000 && JSON.stringify(shades).length < 16000);
  const M = mk();
  M.importPieces(pieces);
  M.importMeta(meta);
  M.importShades(shades);
  M.importHeat(heat);
  assert.equal(M.S.pieces.length, 2);
  assert.equal(M.S.phase, 'wave');
  assert.equal(M.S.wave, N.S.wave);
  assert.equal(M.exportShades().length, shades.length);
  assert.equal(M.S.pending.length, N.S.pending.length);
  assert.equal(Math.round(M.S.t * 100), Math.round(N.S.t * 100));
  for (let i = 0; i < 30 * 5; i++) {
    N.tick();
    M.tick();
  }
  assert.ok(['wave', 'break', 'done', 'lost'].includes(M.S.phase));
  // Garbage imports are ignored, never fatal.
  M.importPieces('nope');
  M.importMeta({ t: 'x', phase: 'zzz', lamps: [{ a: NaN }], players: { a: { f: 1e9 } } });
  M.importShades([[1, 'dragon'], null, [2, 'wisp', 'r', NaN, 1e9, -5, 0]]);
  M.importHeat([[1, NaN]]);
  assert.ok(Number.isFinite(M.S.t));
  assert.ok(M.player('a').focus <= 100);
  for (const s of M.S.shades) assert.ok(Number.isFinite(s.x + s.y));
});

test('abilities: Flare burns and scares, Dawn needs a full meter, Surge refills Focus and waits 60 s', () => {
  const N = mk();
  N.command('a', { op: 'wave' });
  assert.equal(N.command('a', { op: 'dawn' }).ok, false);
  N.S.dawn.charge = N.S.dawn.max;
  assert.equal(N.command('a', { op: 'dawn' }).ok, true);
  assert.ok(N.S.dawn.until > N.S.t);
  N.player('a').focus = 0;
  assert.equal(N.command('a', { op: 'surge' }).ok, true);
  assert.equal(N.player('a').focus, 100);
  assert.equal(N.command('a', { op: 'surge' }).ok, false);
  assert.equal(N.command('a', { op: 'flare', x: 672, y: 416 }).ok, true);
  assert.equal(N.command('a', { op: 'flare', x: 672, y: 416 }).ok, false);
  const ev = N.drainEvents();
  assert.ok(ev.some((e) => e.k === 'flare') && ev.some((e) => e.k === 'dawn') && ev.some((e) => e.k === 'surge'));
});

test('the dusk cannot last forever and selling frees the cell and the Eater chewing it', () => {
  const N = mk();
  for (let i = 0; i < 30 * 185; i++) N.tick();
  assert.equal(N.S.phase, 'wave');
  const r = N.command('a', { op: 'place', type: 'mirror', c: 8, r: 6, angle: 45 });
  N.player('a').focus = 100;
  assert.equal(r.ok, true);
  assert.equal(N.command('a', { op: 'sell', id: r.id }).ok, true);
  assert.equal(N.pieceById(r.id), undefined);
});
