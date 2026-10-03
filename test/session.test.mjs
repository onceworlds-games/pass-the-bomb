// The session over a simulated room: three pages share one state, messages are routed like the platform routes
// them, and the host role moves when a page drops. Covers the paths a real server exercises: a night that
// starts, a guest's command, a lying guest, snapshots, a reload, a host change and a second night.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../game/net/session.js';

/** A room shared by several pages: state and messages are delivered synchronously, host is the first page. */
function makeRoomBus() {
  const pages = [];
  const shared = { state: {}, match: { phase: 'lobby', n: 0, id: null, seed: 0, participants: [] }, host: null, t0: 0, now: 0 };
  const emitAll = (ev, ...args) => pages.forEach((p) => p.emit(ev, ...args));
  function join(id, name) {
    const listeners = new Map();
    const me = { id, name, presence: {}, team: 0, connected: true, ready: false };
    const room = {
      kind: 'private',
      me,
      players: new Map(),
      get online() {
        return room.players;
      },
      get host() {
        return shared.host;
      },
      get isHost() {
        return shared.host === id && me.connected;
      },
      get connected() {
        return me.connected;
      },
      get state() {
        return shared.state;
      },
      get match() {
        return shared.match;
      },
      get participants() {
        return shared.match.participants.map((pid) => pages.find((p) => p.room.me.id === pid)?.room.me).filter(Boolean);
      },
      get spectating() {
        return shared.match.phase === 'playing' && !shared.match.participants.includes(id);
      },
      get running() {
        return shared.match.phase === 'playing';
      },
      isParticipant: (pid) => shared.match.participants.includes(pid),
      matchNow: () => (shared.match.phase === 'playing' ? shared.now - shared.t0 : 0),
      canStart: true,
      allReady: true,
      on(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      startMatch() {
        if (shared.match.phase === 'playing') return;
        shared.match = { phase: 'playing', n: shared.match.n + 1, id: `m${shared.match.n + 1}`, seed: 77, participants: pages.map((p) => p.room.me.id) };
        shared.t0 = shared.now;
        emitAll('starting', shared.match);
        emitAll('matchstart', shared.match);
      },
      endMatch() {
        if (shared.match.phase !== 'playing') return;
        const prev = { ...shared.match };
        shared.match = { ...shared.match, phase: 'lobby', participants: [] };
        emitAll('matchend', shared.match, prev);
      },
      pauseMatch() {},
      setState(key, value) {
        if (value == null) delete shared.state[key];
        else shared.state[key] = JSON.parse(JSON.stringify(value));
        for (const p of pages) if (p.room !== room) p.emit('state', key, shared.state[key], id);
      },
      setPresence(pr) {
        me.presence = JSON.parse(JSON.stringify(pr));
      },
      presenceAt: (pid) => room.players.get(pid)?.presence || null,
      send(data, opts) {
        const payload = JSON.parse(JSON.stringify(data));
        for (const p of pages) {
          if (p.room === room || !p.room.me.connected) continue;
          if (opts && opts.to && p.room.me.id !== opts.to) continue;
          p.emit('message', payload, me, shared.now, room.matchNow());
        }
      },
      setReady() {},
      clearReady() {},
      hideLobby() {},
      setOpen() {},
      admit() {},
      leave() {},
      setPrivate() {},
      setPrivateFor() {},
      privateOf: () => ({}),
    };
    const page = {
      room,
      emit(ev, ...args) {
        for (const fn of listeners.get(ev) || []) fn(...args);
      },
    };
    pages.push(page);
    for (const p of pages) for (const q of pages) p.room.players.set(q.room.me.id, q.room.me);
    if (!shared.host) shared.host = id;
    return page;
  }
  function drop(id) {
    const page = pages.find((p) => p.room.me.id === id);
    page.room.me.connected = false;
    if (shared.host === id) {
      shared.host = pages.find((p) => p.room.me.connected)?.room.me.id || null;
      emitAll('host', shared.host);
    }
  }
  function back(id) {
    const page = pages.find((p) => p.room.me.id === id);
    page.room.me.connected = true;
    page.emit('reconnect');
  }
  return { join, drop, back, shared, pages, tick(ms) { shared.now += ms; } };
}

function sessionFor(page) {
  const events = [];
  const s = createSession({ room: page.room, me: page.room.me, hooks: { onEvent: (e) => events.push(e), onRefuse: (r) => events.push({ k: 'refused', r }) } });
  return { s, events };
}

test('three pages play a night: the host simulates, guests mirror, a guest places glass, a liar changes nothing', () => {
  const bus = makeRoomBus();
  const A = sessionFor(bus.join('a', 'Ann'));
  const B = sessionFor(bus.join('b', 'Bo'));
  const C = sessionFor(bus.join('c', 'Cy'));
  const all = [A, B, C];
  A.s.newRun({ seed: 5, kit: 'observer', boardId: 'octagon' });
  assert.ok(bus.shared.state.run);
  bus.pages[0].room.startMatch();
  const step = (ms) => {
    for (let i = 0; i < ms / 16; i++) {
      bus.tick(16);
      for (const x of all) x.s.update(bus.shared.now, 0.016);
    }
  };
  step(300);
  assert.ok(A.s.night() && A.s.isHost(), 'host has a night');
  assert.ok(B.s.night() && !B.s.isHost(), 'guest has a mirror');
  assert.equal(B.s.night().S.phase, 'dusk');
  // A guest places a mirror through the host.
  B.s.command({ op: 'place', type: 'mirror', c: 5, r: 6, angle: 45 });
  step(200);
  assert.equal(A.s.night().S.pieces.length, 1);
  assert.equal(C.s.night().S.pieces.length, 1, 'the other guest sees it through state');
  // A lying guest: garbage commands and a fake snapshot change nothing.
  bus.pages[2].room.send({ t: 'cmd', seq: 9, cmd: { op: 'place', type: 'laser', c: NaN, r: 'x' } }, { to: 'a' });
  bus.pages[2].room.send({ t: 'snap', seq: 1, shades: [[1, 'dragon', 'r', 1e9]] });
  bus.pages[2].room.send({ t: 'cmd', seq: 10, cmd: { op: 'sell', id: 1, extra: { deep: true } } }, { to: 'a' });
  step(200);
  assert.equal(A.s.night().S.pieces.length, 1);
  assert.equal(B.s.night().S.shades.length, 0);
  // The night begins; snapshots carry the ink to the guests.
  A.s.command({ op: 'wave' });
  step(12000);
  assert.equal(A.s.night().S.phase, 'wave');
  assert.equal(B.s.night().S.phase, 'wave');
  assert.ok(A.s.night().S.shades.length > 0, 'ink on the host table');
  assert.equal(B.s.night().S.shades.length, A.s.night().S.shades.length, 'the mirror holds the same ink');
  assert.ok(B.events.some((e) => e.k === 'spawn'), 'events reach the guests');
});

test('a reloaded guest rebuilds its mirror from state; the host dropping hands the night to a guest intact', () => {
  const bus = makeRoomBus();
  const A = sessionFor(bus.join('a', 'Ann'));
  const B = sessionFor(bus.join('b', 'Bo'));
  const C = sessionFor(bus.join('c', 'Cy'));
  const sessions = [A, B, C];
  const live = () => sessions.filter((x) => x.s.room.me.connected);
  const step = (ms) => {
    for (let i = 0; i < ms / 16; i++) {
      bus.tick(16);
      for (const x of live()) x.s.update(bus.shared.now, 0.016);
    }
  };
  A.s.newRun({ seed: 9 });
  bus.pages[0].room.startMatch();
  step(300);
  A.s.command({ op: 'place', type: 'mirror', c: 4, r: 6, angle: 45 });
  A.s.command({ op: 'place', type: 'prism', c: 7, r: 6, angle: 0 });
  A.s.command({ op: 'wave' });
  step(6000);
  const before = { pieces: A.s.night().S.pieces.length, wave: A.s.night().S.wave, t: A.s.night().S.t };
  // Bo reloads: a fresh page joins the same seat and builds a mirror from room state (the old page is gone).
  const B2 = sessionFor({ room: bus.pages[1].room, emit: bus.pages[1].emit });
  sessions[1] = B2;
  B2.s.update(bus.shared.now, 0.016);
  assert.ok(B2.s.night(), 'fresh page has a mirror');
  assert.equal(B2.s.night().S.pieces.length, before.pieces);
  assert.equal(B2.s.night().S.wave, before.wave);
  // The host drops: Cy becomes host and adopts the night from state and its mirror.
  bus.drop('a');
  step(100);
  const newHost = bus.shared.host;
  assert.notEqual(newHost, 'a');
  const H = newHost === 'c' ? C : B2;
  assert.ok(H.s.isHost(), 'a guest is now the host');
  assert.ok(H.s.night(), 'the new host has a night');
  assert.equal(H.s.night().S.pieces.length, before.pieces, 'the glass survived the change of host');
  assert.ok(H.s.night().S.t >= before.t - 0.5, 'the clock did not rewind');
  step(2000);
  assert.ok(H.s.night().S.t > before.t + 1, 'the night goes on under the new host');
  assert.ok(bus.shared.state.night && bus.shared.state.night.mid === bus.shared.match.id);
  // Ann is back as a guest: her old simulation is gone, she mirrors.
  bus.back('a');
  step(300);
  assert.ok(!A.s.isHost());
  assert.ok(A.s.night() && !A.s.S.N, 'the old host mirrors now');
});

test('a run goes through dawn to a second night, and a run lost ends the match', () => {
  const bus = makeRoomBus();
  const A = sessionFor(bus.join('a', 'Ann'));
  const step = (ms) => {
    for (let i = 0; i < ms / 16; i++) {
      bus.tick(16);
      A.s.update(bus.shared.now, 0.016);
    }
  };
  A.s.newRun({ seed: 3 });
  bus.pages[0].room.startMatch();
  step(200);
  // End the night by hand: the host's night phase becomes done, the session closes it after a pause.
  A.s.night().S.phase = 'done';
  step(100);
  return new Promise((resolve) => {
    setTimeout(() => {
      step(100);
      const R = A.s.currentRun();
      assert.equal(bus.shared.match.phase, 'lobby');
      assert.equal(R.phase, 'dawn');
      assert.ok(R.draft && R.draft.options.length >= 2);
      assert.equal(A.s.draft(0), true);
      if (R.fate) A.s.fate(false);
      assert.equal(A.s.currentRun().phase, 'dusk');
      assert.equal(A.s.currentRun().night, 2);
      bus.pages[0].room.startMatch();
      step(200);
      assert.equal(A.s.night().S.night, 2);
      A.s.night().S.phase = 'lost';
      A.s.night().S.lostBy = 'wisp';
      step(100);
      setTimeout(() => {
        step(100);
        assert.equal(A.s.currentRun().phase, 'lost');
        assert.equal(bus.shared.match.phase, 'lobby');
        resolve();
      }, 2800);
    }, 2800);
  });
});

test('the host batches its events: one message per snapshot, not one per frame', () => {
  const bus = makeRoomBus();
  const A = sessionFor(bus.join('a', 'Ann'));
  const B = sessionFor(bus.join('b', 'Bo'));
  const at = [];
  bus.pages[1].room.on('message', (data) => {
    if (data && data.t === 'ev') at.push(bus.shared.now);
  });
  A.s.newRun({ seed: 21 });
  bus.pages[0].room.startMatch();
  for (let i = 0; i < 300; i++) {
    bus.tick(16);
    // Something happens on the host's table every frame (a busy wave).
    if (A.s.night()) A.s.night().S.events.push({ k: 'pulse', c: 3, r: 3, t: 0 });
    A.s.update(bus.shared.now, 0.016);
    B.s.update(bus.shared.now, 0.016);
  }
  assert.ok(B.events.filter((e) => e.k === 'pulse').length > 200, 'the events still reach the guest');
  assert.ok(at.length >= 40 && at.length <= 52, `about ten messages a second (${at.length} in 4.8 s)`);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 90, 'never two in one snapshot period');
});
