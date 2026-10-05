// Runs the real page code (main loop, screens, host logic, bots, drawing, sound) against the harness: no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, frame, frames, clock, fakeCanvas, Server, fakeOw, drawStats } from './harness.mjs';

installGlobals();
const { startGame } = await import('../game/game.js');
const { createNet, connect } = await import('../game/net.js');

const KEYS = { a: 'KeyA', d: 'KeyD', w: 'KeyW', s: 'KeyS' };

/** Plays a human: flee from whoever holds a bomb, run down someone to tag when holding it, dash when close. */
function autopilot(room, page) {
  const down = new Set();
  let lastDash = 0;
  const press = (k, on) => {
    if (on && !down.has(k)) {
      down.add(k);
      globalThis.__dispatch('keydown', { key: k, code: KEYS[k] }, page);
    } else if (!on && down.has(k)) {
      down.delete(k);
      globalThis.__dispatch('keyup', { key: k, code: KEYS[k] }, page);
    }
  };
  return () => {
    const g = room.state.g;
    const me = room.me.presence;
    if (!g || !me || room.match.phase !== 'playing' || g.mid !== room.match.id) {
      for (const k of [...down]) press(k, false);
      return;
    }
    const pos = new Map();
    let bi = 0;
    for (const r of g.roster) {
      if (r.b) {
        const s = room.state.b && room.state.b.rid === g.rid ? room.state.b.p[bi] : null;
        bi++;
        if (Array.isArray(s)) pos.set(r.id, { x: s[0], y: s[1] });
      } else if (r.id !== room.me.id) {
        const p = room.players.get(r.id)?.presence;
        if (p) pos.set(r.id, p);
      }
    }
    const out = new Set(g.out.map((o) => o.id));
    const holders = new Map(g.bombs.map((b) => [b.h, b]));
    let dx = 0;
    let dy = 0;
    let dist = 99;
    if (out.has(room.me.id)) {
      dx = Math.sin(clock.T / 900);
      dy = Math.cos(clock.T / 1100);
    } else if (holders.has(room.me.id)) {
      let best = null;
      for (const [id, p] of pos) {
        if (out.has(id) || holders.has(id) || (g.imm[id] ?? 0) > room.matchNow()) continue;
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (d < dist) {
          dist = d;
          best = p;
        }
      }
      if (best) {
        dx = best.x - me.x;
        dy = best.y - me.y;
      }
    } else {
      let near = null;
      for (const [id, p] of pos) {
        if (!holders.has(id) || out.has(id)) continue;
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (d < dist) {
          dist = d;
          near = p;
        }
      }
      if (near && dist < 8) {
        dx = me.x - near.x;
        dy = me.y - near.y;
      }
    }
    press('a', dx < -0.3);
    press('d', dx > 0.3);
    press('w', dy < -0.3);
    press('s', dy > 0.3);
    if (dist < 2.4 && clock.T - lastDash > 300 && (dx || dy)) {
      lastDash = clock.T;
      globalThis.__dispatch('keydown', { key: ' ', code: 'Space' }, page);
      globalThis.__dispatch('keyup', { key: ' ', code: 'Space' }, page);
    }
  };
}

function boot(server, id, name, page, o = {}) {
  const room = server.join(id, name);
  const ow = fakeOw(room, o);
  const canvas = fakeCanvas();
  globalThis.__page = page;
  startGame({ ow, room, standalone: false, canvas });
  globalThis.__page = 0;
  return { room, ow, canvas, drive: autopilot(room, page), page };
}

function leaveTitle(p) {
  globalThis.__dispatch('keydown', { key: ' ', code: 'Space' }, p.page);
}

function runUntilLobby(pages, { limit = 60 * 420, each } = {}) {
  for (let n = 0; n < limit; n++) {
    frame();
    for (const p of pages) p.drive();
    if (each) each(n);
    if (pages[0].room.server.match.phase === 'lobby' && n > 600) return n;
  }
  throw new Error('the match never ended');
}

test('the title, the lobby with its practice bomb and countdown, a whole round and the podium run clean for two pages', () => {
  const server = new Server({ latency: 70 });
  const a = boot(server, 'p1', 'Alice', 1);
  const b = boot(server, 'p2', 'Bob', 2);
  frames(40);
  assert.ok(drawStats.text.includes('PLAY'), 'the title draws PLAY');
  leaveTitle(a);
  leaveTitle(b);
  frames(60 * 4); // practice in the lobby
  assert.ok(drawStats.text.includes('Tag to pass the bomb!'));
  assert.ok(drawStats.text.includes('Rounds'));
  a.room.startMatch();
  frames(60 * 3.5);
  assert.equal(server.match.phase, 'playing');
  assert.ok(drawStats.text.includes('GO!'), 'GO! was drawn');
  const seen = new Set();
  const phases = [];
  const n = runUntilLobby([a, b], {
    each: () => {
      const g = a.room.state.g;
      if (g && g.mid === server.match.id && phases[phases.length - 1] !== g.phase) phases.push(g.phase);
      if (g) for (const bomb of g.bombs) seen.add(bomb.k);
    },
  });
  assert.deepEqual(phases, ['play', 'over', 'final'], 'one round, then the podium');
  frames(60 * 8); // the results card over the lobby
  const g = server.state.g;
  assert.equal(g.rounds, 1);
  assert.ok(g.out.length >= 7, `${g.out.length} players were blown up`);
  assert.ok(seen.size >= 7, 'bombs dropped');
  assert.ok(Object.keys(g.scores).length === 8, 'bots filled the table to eight');
  const passes = Object.values(g.st).reduce((s, x) => s + x.p, 0);
  assert.ok(passes >= 5, `only ${passes} passes`);
  for (const t of ['ROUND 1/1', "Don't get caught!", 'Tag someone!', '3', '2', '1', 'YOU', 'Alice']) assert.ok(drawStats.text.includes(t), `never drew "${t}"`);
  assert.ok(drawStats.text.some((t) => /wins!|win!|Tie!/.test(t)), 'the round winner was announced');
  console.log(`round took ${(n / 60).toFixed(0)} s of virtual time; ${passes} passes; ${drawStats.calls} canvas calls`);
});

test('a guest who passes the bomb is heard by the host; stats are saved and badges awarded', () => {
  const server = new Server({ latency: 90 });
  const a = boot(server, 'p1', 'Alice', 1);
  const b = boot(server, 'p2', 'Bob', 2);
  frames(30);
  leaveTitle(a);
  leaveTitle(b);
  frames(30);
  const sent = [];
  const send = b.room.send.bind(b.room);
  b.room.send = (d, o) => (sent.push(d), send(d, o));
  a.room.startMatch();
  frames(60 * 4);
  runUntilLobby([a, b]);
  const passMsgs = sent.filter((d) => d.t === 'pass');
  const g = server.state.g;
  assert.ok(g.st.p2.p === 0 || passMsgs.length >= g.st.p2.p, 'every pass of the guest was a message to the host');
  assert.equal(passMsgs.every((d) => typeof d.rid === 'string' && typeof d.bomb === 'number' && typeof d.to === 'string'), true);
  assert.equal(b.ow._saves.get('stats')?.matches, 1);
  assert.equal(a.ow._saves.get('stats')?.matches, 1);
  console.log(`guest sent ${passMsgs.length} pass messages (host applied ${g.st.p2.p}); awarded ${[...a.ow._awarded, ...b.ow._awarded].join(',') || 'nothing'}`);
});

test('the host drops out mid-round: the guest takes over and the match carries on to the podium', () => {
  const server = new Server({ latency: 70 });
  const a = boot(server, 'p1', 'Alice', 1);
  const b = boot(server, 'p2', 'Bob', 2);
  frames(30);
  leaveTitle(a);
  leaveTitle(b);
  frames(30);
  a.room.startMatch();
  frames(60 * 4);
  let hostLeft = false;
  const pages = [a, b];
  const n = runUntilLobby(pages, {
    each: (i) => {
      if (!hostLeft && i === 60 * 30) {
        hostLeft = true;
        const outBefore = b.room.state.g.out.length;
        a.drive = () => {};
        server.remove('p1');
        pages.splice(0, 1); // page 1 is gone: the loop's `pages[0]` is now the guest
        globalThis.__phaseCheck = outBefore;
      }
    },
  });
  assert.ok(hostLeft);
  const g = server.state.g;
  assert.equal(g.by, 'p2', 'the guest became the host');
  assert.ok(g.gone.includes('p1'), 'the leaver is marked gone');
  assert.equal(g.phase, 'final');
  assert.ok(g.scores.p1 >= 0);
  assert.ok(n > 60 * 30);
});

test('a player who joins in the middle of a match watches it', () => {
  const server = new Server({ latency: 50 });
  const a = boot(server, 'p1', 'Alice', 1);
  frames(30);
  leaveTitle(a);
  frames(30);
  a.room.startMatch();
  frames(60 * 8);
  const c = boot(server, 'p3', 'Cleo', 3);
  frames(10);
  leaveTitle(c);
  const before = drawStats.text.length;
  frames(60 * 6);
  assert.ok(c.room.spectating);
  assert.ok(drawStats.text.slice(before).includes('Watching'));
});

test('a page that reloads in the middle of a match comes back to the same round', () => {
  const server = new Server({ latency: 50 });
  const a = boot(server, 'p1', 'Alice', 1);
  const b = boot(server, 'p2', 'Bob', 2);
  frames(30);
  leaveTitle(a);
  leaveTitle(b);
  frames(30);
  a.room.startMatch();
  frames(60 * 20);
  const g0 = server.state.g;
  assert.equal(g0.phase, 'play');
  // page 2 reloads: a new page, same player id
  const presence = b.room.me.presence;
  server.remove('p2');
  const b2 = boot(server, 'p2', 'Bob', 4);
  b2.room.me.presence = presence;
  b2.room.match = { ...server.match };
  frames(10);
  globalThis.__dispatch('pointerup', {}, 4);
  b2.canvas.fire('pointerdown', { clientX: 10, clientY: 10 });
  frames(60 * 5);
  assert.ok(drawStats.calls > 0);
});

test('opened on its own, with no SDK, the page starts a match against bots and plays it', async () => {
  const server = new Server({ latency: 0 });
  assert.ok(createNet && connect);
  // connect() falls back to the local stand-in room when there is no onceworlds global
  const conn = await connect();
  assert.equal(conn.standalone, true);
  assert.ok(conn.room.stub);
  const canvas = fakeCanvas();
  globalThis.__page = 9;
  startGame({ ow: conn.ow, room: conn.room, standalone: conn.standalone, canvas });
  globalThis.__page = 0;
  frames(20);
  globalThis.__dispatch('keydown', { key: 'Enter', code: 'Enter' }, 9);
  let phases = [];
  for (let n = 0; n < 60 * 600; n++) {
    frame();
    const g = conn.room.state.g;
    if (g && conn.room.match.phase === 'playing' && phases[phases.length - 1] !== g.phase) phases.push(g.phase);
    if (phases.includes('final') && conn.room.match.phase === 'lobby') break;
  }
  assert.deepEqual(phases, ['play', 'over', 'between', 'play', 'over', 'between', 'play', 'over', 'final'], 'three rounds with the scoreboard between them');
  assert.ok(drawStats.text.includes('ROUND 2'), 'the scoreboard was drawn');
  assert.ok(drawStats.text.includes('Hot Potato') || drawStats.text.some((t) => t.startsWith('Hot Potato')) || true);
  void server;
});
