// The room and the host's side of a match. Everyone's page reads one record, `g` (see engine.js), that only the host writes.
// The host's page keeps it moving: a 50 ms ticker applies the clock (drops, explosions, screens) and the host also moves the
// bots. Passes arrive as messages from the holder's page; the host checks them and writes `g`. A new host just carries on
// from `g` in room state and the bots' last snapshot (`b`), so nothing is reset when the role changes hands.
//
// Page-only module: it uses the SDK's room (or a small local stand-in when the file is opened on its own).

import { buildRoster, clone, DEFAULT_ROUNDS, MAP_IDS, ROUND_OPTIONS, clamp } from './rules.js';
import { mapOf } from './maps.js';
import * as engine from './engine.js';
import { createBotWorld, placeBots, adoptBots, stepBots, snapshotBots } from './botworld.js';

export const SETTINGS = [
  { id: 'rounds', label: 'Rounds', options: ROUND_OPTIONS, default: DEFAULT_ROUNDS },
  { id: 'map', label: 'Map', options: [{ value: 'backyard', label: 'Backyard' }, { value: 'beach', label: 'Beach' }, { value: 'playground', label: 'Playground' }], default: 'backyard' },
];

const MAX_TAG_LAG = 5.5; // how far apart (units) a tag may look to the host, for the lag of two pages

// ---------------------------------------------------------------- joining

export async function connect() {
  const hasSdk = typeof window !== 'undefined' && !!window.onceworlds;
  const ow = hasSdk ? window.onceworlds : stubOw();
  let room = null;
  if (hasSdk) {
    try {
      room = await ow.rooms.join({ maxPlayers: 12, minPlayers: 1, lobby: 'bar', settings: SETTINGS });
    } catch (err) {
      console.warn('[pass-the-bomb] could not join a room, playing alone', err);
    }
  }
  if (!room) room = stubRoom();
  return { ow, room, standalone: !hasSdk || room.stub === true || ow.mode === 'standalone' };
}

function stubOw() {
  const noop = () => {};
  return {
    mode: 'standalone',
    now: () => Date.now(),
    settings: { quality: 'high', scale: 1, reducedMotion: false, choice: 'auto', pixelRatio: (m = 2) => Math.min(window.devicePixelRatio || 1, m), on: () => noop },
    controls: { set: noop, stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    ui: { setOrientation: noop, showInvite: noop, setMenuPosition: noop, requestFullscreen: noop },
    player: { get: async () => ({ id: 'me', name: 'You', guest: true }), avatarUrl: async () => null },
    save: { get: async () => null, set: async () => {}, delete: async () => {} },
    badges: { award: async () => false },
    leaderboards: { submit: async () => null },
    on: () => noop,
  };
}

/** A room for one, for when the page is opened on its own: it plays a match alone against bots. */
function stubRoom() {
  const listeners = new Map();
  const me = { id: 'me', name: 'You', presence: null, team: 0 };
  const room = {
    stub: true,
    id: 'stub',
    kind: 'solo',
    me,
    host: 'me',
    connected: true,
    state: {},
    players: new Map([['me', me]]),
    match: { phase: 'lobby', n: 0, min: 1 },
    settings: { rounds: DEFAULT_ROUNDS, map: 'backyard' },
    get isHost() {
      return true;
    },
    get online() {
      return [me];
    },
    get participants() {
      return this.match.phase === 'lobby' ? [] : [me];
    },
    get spectating() {
      return false;
    },
    get running() {
      return this.match.phase === 'playing';
    },
    on(e, f) {
      let s = listeners.get(e);
      if (!s) listeners.set(e, (s = new Set()));
      s.add(f);
      return () => s.delete(f);
    },
    emit(e, ...a) {
      for (const f of listeners.get(e) ?? []) f(...a);
    },
    matchNow() {
      return this.match.phase === 'playing' ? Math.max(0, Date.now() - this.match.startedAt) : 0;
    },
    setPresence(p) {
      me.presence = p;
    },
    presenceAt(id) {
      return id === 'me' ? me.presence : null;
    },
    setState(k, v) {
      if (v === null || v === undefined) delete this.state[k];
      else this.state[k] = v;
    },
    send() {},
    setReady() {},
    clearReady() {},
    setSetting(id, value) {
      if (this.match.phase === 'lobby') {
        this.settings = { ...this.settings, [id]: value };
        this.emit('settings', this.settings);
      }
    },
    hideLobby() {},
    startMatch() {
      if (this.match.phase !== 'lobby') return;
      const n = this.match.n + 1;
      this.match = { phase: 'starting', n, min: 1, id: 'stub' + n, seed: Math.floor(Math.random() * 4294967296), participants: ['me'], startsAt: Date.now() + 3000 };
      this.emit('starting', this.match);
      setTimeout(() => {
        if (this.match.phase !== 'starting') return;
        const { startsAt, ...rest } = this.match;
        this.match = { ...rest, phase: 'playing', startedAt: Date.now(), pausedMs: 0 };
        this.emit('matchstart', this.match);
      }, 3000);
    },
    endMatch() {
      if (this.match.phase === 'lobby') return;
      const previous = this.match;
      this.match = { phase: 'lobby', n: previous.n, min: 1 };
      this.emit('matchend', this.match, previous);
    },
    leave() {},
  };
  return room;
}

// ---------------------------------------------------------------- one record, checked

const checked = { g: null, ok: false };

/** Is this record of the shape every page relies on? (It comes from another player's page, so it is checked once, here.) */
function sane(g) {
  if (g === checked.g) return checked.ok;
  checked.g = g;
  checked.ok = check(g);
  return checked.ok;
}

function check(g) {
  try {
    if (!g || typeof g !== 'object') return false;
    const arr = Array.isArray;
    if (!arr(g.roster) || g.roster.length < 1 || g.roster.length > 16 || !arr(g.bombs) || g.bombs.length > 4 || !arr(g.out) || !arr(g.gone) || !arr(g.drops) || !arr(g.pl) || !arr(g.first)) return false;
    for (const r of g.roster) if (!r || typeof r.id !== 'string' || typeof r.n !== 'string' || !Number.isFinite(r.c)) return false;
    for (const b of g.bombs) if (!b || typeof b.h !== 'string' || ![b.k, b.b, b.s, b.p, b.a].every(Number.isFinite)) return false;
    for (const o of g.out) if (!o || typeof o.id !== 'string' || !Number.isFinite(o.t)) return false;
    for (const k of ['imm', 'stun', 'scores', 'rs', 'st']) if (!g[k] || typeof g[k] !== 'object') return false;
    return typeof g.rid === 'string' && typeof g.phase === 'string' && typeof g.map === 'string' && ![g.n, g.rounds, g.until, g.t0].some((x) => !Number.isFinite(x));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the host

/**
 * hooks.posOf(id): where a human is drawn ({ x, y } or null), for the host's checks and for bots to dodge.
 */
export function createNet(room, ow, hooks) {
  const me = room.me.id;
  const botIds = new Set();
  let botMid = '';
  let bw = null;
  let bwRid = '';
  let endTry = 0;
  let lastSnap = -1e9;
  const snaps = [];

  const G = () => room.state.g ?? null;
  /** The record of this match, or null (none yet, stale from the last match, or malformed). */
  function validG() {
    const g = G();
    if (!g || room.match.phase !== 'playing' || g.mid !== room.match.id || !sane(g)) return null;
    return g;
  }

  function refreshBots(g) {
    if (botMid === g.mid) return;
    botMid = g.mid;
    botIds.clear();
    for (const r of g.roster) if (r.b) botIds.add(r.id);
  }

  const ctx = {
    rand: Math.random,
    status(id) {
      if (botIds.has(id)) return 'ok';
      const p = room.players.get(id);
      if (!p) return 'gone';
      return p.connected === false ? 'away' : 'ok';
    },
    pos(id) {
      const e = bw && bw.bots.get(id);
      if (e) return e.ch;
      return hooks.posOf(id);
    },
  };

  function amHost(g) {
    return room.isHost && room.running && g && g.by === me && g.mid === room.match.id;
  }

  function startRecord() {
    if (!room.isHost) return;
    const m = room.match;
    const humans = (m.participants ?? []).filter((id) => room.players.has(id));
    const roster = buildRoster(humans, m.seed ?? 1, (id) => room.players.get(id)?.name ?? 'Player');
    botIds.clear();
    for (const r of roster) if (r.b) botIds.add(r.id);
    botMid = m.id;
    const rounds = Number(room.settings.rounds);
    const map = String(room.settings.map);
    const g = engine.newMatch({ mid: m.id, by: me, roster, rounds: ROUND_OPTIONS.includes(rounds) ? rounds : DEFAULT_ROUNDS, map: MAP_IDS.includes(map) ? map : 'backyard' }, room.matchNow(), Math.random, ctx);
    bwRid = '';
    snaps.length = 0;
    room.setState('b', null);
    room.setState('g', g);
  }

  /** Carries on as the host: from room state. Safe to call as often as you like. */
  function adopt() {
    if (!room.isHost || !room.running) return;
    const g = G();
    if (!g || g.mid !== room.match.id || !sane(g)) return startRecord();
    if (g.by === me) return;
    bwRid = '';
    refreshBots(g);
    room.setState('g', { ...g, by: me });
  }

  function tickHost() {
    // If the host role came to this page while the match waited (nobody was running it), or the record is somebody else's, take it over.
    if (room.isHost && room.running) {
      const cur = G();
      if (!cur || cur.mid !== room.match.id || cur.by !== me || !sane(cur)) adopt();
    }
    const g = validG();
    if (!amHost(g)) return;
    refreshBots(g);
    const next = clone(g);
    const res = engine.tick(next, room.matchNow(), ctx);
    if (res === engine.TICK_END) {
      if (Date.now() - endTry > 2000) {
        endTry = Date.now();
        room.endMatch(); // everyone is back in the lobby (it is called again if the first never got through)
      }
      return;
    }
    if (res === engine.TICK_DIRTY) room.setState('g', next);
  }

  function commitPass(k, to) {
    const g = G();
    if (!g) return false;
    const next = clone(g);
    if (!engine.pass(next, k, to, room.matchNow(), ctx)) return false;
    room.setState('g', next);
    return true;
  }

  /** A holder says they touched `to`. The host checks it against the record and applies it once. */
  function handlePass(fromId, rid, k, to) {
    const g = validG();
    if (!amHost(g) || g.phase !== 'play' || rid !== g.rid || typeof k !== 'number' || typeof to !== 'string') return false;
    const b = g.bombs.find((x) => x.k === k);
    if (!b || b.h !== fromId) return false;
    const pa = ctx.pos(fromId);
    const pb = ctx.pos(to);
    if (pa && pb && Math.hypot(pa.x - pb.x, pa.y - pb.y) > MAX_TAG_LAG) return false;
    return commitPass(k, to);
  }

  room.on('message', (d, from) => {
    if (!d || typeof d !== 'object' || d.t !== 'pass' || !from) return;
    handlePass(from.id, d.rid, d.bomb, d.to);
  });

  /** My own tag: the host applies it directly, anyone else asks the host. */
  function requestPass(g, k, to) {
    if (amHost(g)) handlePass(me, g.rid, k, to);
    else room.send({ t: 'pass', rid: g.rid, bomb: k, to }, { to: room.host });
  }

  /** The host moves the bots one step and publishes where they are (about 12 times a second). */
  function hostStep(dt, now, others) {
    const g = validG();
    if (!amHost(g) || (g.phase !== 'play' && g.phase !== 'over')) return;
    refreshBots(g);
    const map = mapOf(g.map);
    if (!bw) bw = createBotWorld(Math.random);
    if (bwRid !== g.rid) {
      bwRid = g.rid;
      const snap = room.state.b;
      if (snap && snap.rid === g.rid) adoptBots(bw, g, map, snap);
      else placeBots(bw, g, map);
    }
    const tag = stepBots(bw, g, map, dt, now, others);
    if (tag) commitPass(tag.k, tag.to);
    if (now - lastSnap >= 80) {
      lastSnap = now;
      room.setState('b', { rid: g.rid, t: Math.round(now), p: snapshotBots(bw, g) });
    }
  }

  // ---- where the bots are, for pages that don't run them
  function pushSnap(v) {
    if (!v || typeof v !== 'object' || typeof v.rid !== 'string' || !Number.isFinite(v.t) || !Array.isArray(v.p)) return;
    if (snaps.length && snaps[snaps.length - 1].rid !== v.rid) snaps.length = 0;
    snaps.push({ rid: v.rid, t: v.t, p: v.p });
    if (snaps.length > 5) snaps.shift();
  }
  room.on('state', (key, value) => {
    if (key === 'b') pushSnap(value);
  });
  pushSnap(room.state.b);

  const num4 = (a) => Array.isArray(a) && a.length >= 4 && Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]) && Number.isFinite(a[3]);

  /** The `index`-th bot of the roster, drawn at match time `renderT`, between the two snapshots around it. Fills out; false if unknown. */
  function botAt(index, rid, renderT, out) {
    const n = snaps.length;
    if (!n || snaps[n - 1].rid !== rid) return false;
    let a = null;
    let b = null;
    for (let i = n - 1; i >= 0; i--) {
      if (snaps[i].t <= renderT) {
        a = snaps[i];
        b = snaps[i + 1] ?? null;
        break;
      }
    }
    if (!a) a = snaps[0];
    const pa = a.p[index];
    if (!num4(pa)) return false;
    const pb = b ? b.p[index] : null;
    if (!pb || !num4(pb) || b.t <= a.t) {
      const dt = clamp((renderT - a.t) / 1000, 0, 0.15);
      out.x = pa[0] + pa[2] * dt;
      out.y = pa[1] + pa[3] * dt;
      out.vx = pa[2];
      out.vy = pa[3];
      out.dash = pa[4] === 1;
      return true;
    }
    if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 4) {
      out.x = pb[0];
      out.y = pb[1];
    } else {
      const u = clamp((renderT - a.t) / (b.t - a.t), 0, 1);
      out.x = pa[0] + (pb[0] - pa[0]) * u;
      out.y = pa[1] + (pb[1] - pa[1]) * u;
    }
    out.vx = pb[2];
    out.vy = pb[3];
    out.dash = pb[4] === 1;
    return true;
  }

  room.on('matchstart', () => {
    bwRid = '';
    adopt();
  });
  room.on('host', () => {
    bwRid = '';
    adopt();
  });
  room.on('reconnect', () => {
    bwRid = '';
    adopt();
  });
  room.on('matchresume', () => {
    bwRid = '';
    adopt();
  });
  setInterval(tickHost, 50);
  adopt();

  /** A bot's character on the host's page, once the host has placed the bots for round `rid`. */
  function botChar(id, rid) {
    if (!bw || bwRid !== rid) return null;
    const e = bw.bots.get(id);
    return e ? e.ch : null;
  }

  return { G, validG, requestPass, hostStep, botAt, botChar, botIds, ctx, amHost, adopt };
}
