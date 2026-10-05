// A stand-in for the browser and the platform, enough to run the whole page code in node: a virtual clock, timers and
// animation frames, a canvas that checks every drawing call (no NaN, no negative radius, alpha in range), a fake
// AudioContext, and a small fake multiplayer server with the SDK's room semantics (latency included).
// No real browser is involved.

export const clock = { T: 1_000_000 };
const timers = [];
let tid = 1;
const rafQ = [];

export function installGlobals({ width = 844, height = 390 } = {}) {
  globalThis.window = globalThis;
  globalThis.innerWidth = width;
  globalThis.innerHeight = height;
  globalThis.devicePixelRatio = 2;
  globalThis.location = { search: '', reload() {} };
  Date.now = () => clock.T;
  try {
    Object.defineProperty(performance, 'now', { value: () => clock.T, configurable: true, writable: true });
  } catch {
    // older runtimes
  }
  globalThis.setTimeout = (fn, ms = 0) => {
    const id = tid++;
    timers.push({ id, at: clock.T + ms, fn });
    return id;
  };
  globalThis.setInterval = (fn, ms) => {
    const id = tid++;
    timers.push({ id, at: clock.T + ms, fn, every: ms });
    return id;
  };
  globalThis.clearTimeout = globalThis.clearInterval = (id) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  globalThis.requestAnimationFrame = (fn) => rafQ.push(fn);
  const handlers = new Map();
  globalThis.__handlers = handlers;
  globalThis.addEventListener = (type, fn) => {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push({ fn, page: globalThis.__page ?? 0 });
  };
  globalThis.__dispatch = (type, ev, page = 0) => {
    for (const h of handlers.get(type) ?? []) if (h.page === page) h.fn({ preventDefault() {}, isTrusted: true, ...ev });
  };
  globalThis.document = {
    hidden: false,
    createElement: () => fakeCanvas(),
    getElementById: () => fakeCanvas(),
    addEventListener() {},
    fonts: { load: async () => [], ready: Promise.resolve() },
    documentElement: { style: {} },
    body: { dataset: {}, style: {} },
  };
  globalThis.Image = class {};
  globalThis.AudioContext = function () {
    return anything();
  };
}

function anything() {
  const fn = function () {};
  return new Proxy(fn, {
    get(t, p) {
      if (p === 'currentTime') return clock.T / 1000;
      if (p === 'sampleRate') return 44100;
      if (p === 'state') return 'running';
      if (p === 'then') return undefined;
      if (p === Symbol.toPrimitive) return () => 0;
      return anything();
    },
    set: () => true,
    apply: () => anything(),
    construct: () => anything(),
  });
}

/** Runs due timers, then the animation frames, for one frame of virtual time (~16.7 ms). */
export function frame(ms = 1000 / 60) {
  clock.T += ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > clock.T) break;
    if (t.every) t.at += t.every;
    else timers.shift();
    t.fn();
  }
  const cbs = rafQ.splice(0);
  for (const cb of cbs) cb(clock.T);
}

export function frames(n) {
  for (let i = 0; i < n; i++) frame();
}

// ---------------------------------------------------------------- the canvas

const fnCache = new Map();
export const drawStats = { calls: 0, text: [] };

function check(name, args) {
  drawStats.calls++;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`canvas.${name}: argument ${i} is ${a} (${args.join(', ')})`);
  }
  if (name === 'arc' && args[2] < 0) throw new Error(`canvas.arc with a negative radius: ${args.join(', ')}`);
  if (name === 'ellipse' && (args[2] < 0 || args[3] < 0)) throw new Error(`canvas.ellipse with a negative radius: ${args.join(', ')}`);
  if (name === 'arcTo' && args[4] < 0) throw new Error(`canvas.arcTo with a negative radius: ${args.join(', ')}`);
  if ((name === 'createRadialGradient') && (args[2] < 0 || args[5] < 0)) throw new Error('negative gradient radius');
  if (name === 'fillText' || name === 'strokeText') drawStats.text.push(String(args[0]));
}

export function fakeCtx() {
  const state = { font: '10px sans-serif', globalAlpha: 1, lineWidth: 1 };
  let depth = 0;
  return new Proxy(
    {},
    {
      get(t, p) {
        if (typeof p === 'symbol') return undefined;
        if (p in state) return state[p];
        if (p === 'measureText') return (s) => ({ width: String(s).length * (parseFloat(state.font) || 10) * 0.55 });
        if (p === 'createRadialGradient' || p === 'createLinearGradient') {
          return (...a) => {
            check(p, a);
            return { addColorStop() {} };
          };
        }
        if (p === 'save') return () => void depth++;
        if (p === 'restore') return () => {
          depth--;
          if (depth < 0) throw new Error('canvas restore without save');
        };
        let f = fnCache.get(p);
        if (!f) {
          f = (...a) => check(p, a);
          fnCache.set(p, f);
        }
        return f;
      },
      set(t, p, v) {
        if (p === 'lineWidth' && !(v > 0 && Number.isFinite(v))) throw new Error(`lineWidth ${v}`);
        if (p === 'globalAlpha' && !(v >= 0 && v <= 1)) throw new Error(`globalAlpha ${v}`);
        if ((p === 'fillStyle' || p === 'strokeStyle') && typeof v === 'string' && !/^(#[0-9a-f]{3,8}|rgba?\([\d., ]+\)|[a-z]+)$/i.test(v)) throw new Error(`${p} ${v}`);
        if (p === 'font' && (/NaN|undefined|Infinity/.test(v) || !/^\d+(\.\d+)?px /.test(v))) throw new Error(`font ${v}`);
        state[p] = v;
        return true;
      },
    },
  );
}

export function fakeCanvas() {
  const ctx = fakeCtx();
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ctx,
    addEventListener(type, fn) {
      (this.handlers ??= new Map()).set(type, [...((this.handlers.get(type)) ?? []), fn]);
    },
    fire(type, ev) {
      for (const fn of this.handlers?.get(type) ?? []) fn({ preventDefault() {}, ...ev });
    },
  };
}

// ---------------------------------------------------------------- a small fake server with the SDK's room semantics

export class Server {
  constructor({ latency = 70 } = {}) {
    this.latency = latency;
    this.rooms = new Map();
    this.state = {};
    this.settings = { rounds: 1, map: 'backyard' };
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.hostId = null;
    this.matchSeq = 0;
  }
  later(fn) {
    if (this.latency <= 0) fn();
    else setTimeout(fn, this.latency);
  }
  join(id, name) {
    const room = new FakeRoom(this, id, name);
    for (const other of this.rooms.values()) {
      room.players.set(other.me.id, { id: other.me.id, name: other.me.name, presence: other.me.presence, team: 0, ...(other.me.ready ? { ready: true } : {}) });
      this.later(() => {
        other.players.set(id, { id, name, presence: null, team: 0 });
        other.emit('join', other.players.get(id));
      });
    }
    this.rooms.set(id, room);
    if (!this.hostId) this.hostId = id;
    room.host = this.hostId;
    room.state = { ...this.state };
    room.match = { ...this.match };
    return room;
  }
  broadcastMatch(prev) {
    for (const r of this.rooms.values()) {
      const before = r.match;
      r.match = { ...this.match };
      r.emit('match', r.match, before);
    }
  }
  remove(id, reason = 'left') {
    const room = this.rooms.get(id);
    if (!room) return;
    this.rooms.delete(id);
    room.closed = true;
    for (const r of this.rooms.values()) {
      this.later(() => {
        const p = r.players.get(id);
        r.players.delete(id);
        if (p) r.emit('leave', p, false);
      });
    }
    if (this.hostId === id) {
      const next = [...this.rooms.values()].find((r) => this.match.participants?.includes(r.me.id)) ?? [...this.rooms.values()][0];
      this.hostId = next ? next.me.id : null;
      for (const r of this.rooms.values()) {
        r.host = this.hostId;
        this.later(() => r.emit('host', this.hostId));
      }
    }
  }
}

export class FakeRoom {
  constructor(server, id, name) {
    this.server = server;
    this.me = { id, name, presence: null, team: 0 };
    this.players = new Map([[id, this.me]]);
    this.state = {};
    this.listeners = new Map();
    this.connected = true;
    this.kind = 'public';
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.frozen = null;
    this.samples = new Map();
  }
  get settings() {
    return this.frozen ?? this.server.settings;
  }
  get isHost() {
    return this.connected && this.host === this.me.id;
  }
  get online() {
    return [...this.players.values()].filter((p) => p.connected !== false);
  }
  get participants() {
    const ids = this.match.participants;
    if (this.match.phase === 'lobby' || !ids) return [];
    return ids.map((id) => this.players.get(id)).filter(Boolean);
  }
  isParticipant(id = this.me.id) {
    return this.match.phase !== 'lobby' && !!this.match.participants?.includes(id);
  }
  get spectating() {
    return this.match.phase !== 'lobby' && !this.isParticipant();
  }
  get running() {
    return this.match.phase === 'playing' && !this.match.paused;
  }
  matchNow() {
    const m = this.match;
    if (m.phase !== 'playing' || m.startedAt === undefined) return 0;
    return Math.max(0, clock.T - m.startedAt - (m.pausedMs ?? 0));
  }
  on(e, f) {
    let s = this.listeners.get(e);
    if (!s) this.listeners.set(e, (s = new Set()));
    s.add(f);
    return () => s.delete(f);
  }
  emit(e, ...a) {
    for (const f of [...(this.listeners.get(e) ?? [])]) f(...a);
  }
  setPresence(p) {
    this.me.presence = p;
    const snap = JSON.parse(JSON.stringify(p));
    for (const r of this.server.rooms.values()) {
      if (r === this) continue;
      this.server.later(() => {
        const pl = r.players.get(this.me.id);
        if (pl) pl.presence = snap;
      });
    }
  }
  presenceAt(id) {
    if (id === this.me.id) return this.me.presence;
    return this.players.get(id)?.presence ?? null;
  }
  setState(k, v) {
    if (this.closed) return;
    const val = v === null || v === undefined ? null : JSON.parse(JSON.stringify(v));
    if (val === null) delete this.state[k];
    else this.state[k] = v;
    if (val === null) delete this.server.state[k];
    else this.server.state[k] = val;
    for (const r of this.server.rooms.values()) {
      if (r === this) continue;
      this.server.later(() => {
        if (val === null) delete r.state[k];
        else r.state[k] = JSON.parse(JSON.stringify(val));
        r.emit('state', k, val, this.me.id);
      });
    }
  }
  send(data, { to } = {}) {
    if (this.closed) return;
    const copy = JSON.parse(JSON.stringify(data));
    for (const r of this.server.rooms.values()) {
      if (r === this || (to && r.me.id !== to)) continue;
      this.server.later(() => r.emit('message', copy, r.players.get(this.me.id) ?? { id: this.me.id, name: '?' }, clock.T, r.matchNow()));
    }
  }
  setReady() {}
  clearReady() {}
  hideLobby() {}
  setSetting(id, v) {
    if (this.isHost && this.match.phase === 'lobby') this.server.settings = { ...this.server.settings, [id]: v };
  }
  startMatch() {
    const s = this.server;
    if (!this.isHost || s.match.phase !== 'lobby') return;
    const n = ++s.matchSeq;
    const ids = [...s.rooms.keys()];
    s.match = { phase: 'starting', n, min: 1, id: 'fake' + n, seed: 1234 + n, participants: ids, startsAt: clock.T + 3000 };
    for (const r of s.rooms.values()) r.frozen = { ...s.settings };
    s.broadcastMatch();
    for (const r of s.rooms.values()) r.emit('starting', r.match);
    setTimeout(() => {
      if (s.match.phase !== 'starting') return;
      const { startsAt, ...rest } = s.match;
      s.match = { ...rest, phase: 'playing', startedAt: clock.T, pausedMs: 0 };
      s.state = {};
      s.broadcastMatch();
      for (const r of s.rooms.values()) r.emit('matchstart', r.match);
    }, 3000);
  }
  endMatch() {
    const s = this.server;
    if (s.match.phase === 'lobby') return;
    const previous = { ...s.match };
    s.match = { phase: 'lobby', n: previous.n, min: 1 };
    for (const r of s.rooms.values()) {
      r.frozen = null;
      r.match = { ...s.match };
      r.emit('matchend', r.match, previous);
    }
  }
  leave() {
    this.server.remove(this.me.id);
  }
}

/** The SDK's global, as far as the game uses it. */
export function fakeOw(room, { touch = false } = {}) {
  const noop = () => {};
  const pressed = new Set();
  const awarded = [];
  const saves = new Map();
  return {
    mode: 'platform',
    now: () => clock.T,
    settings: { quality: 'high', scale: 1, reducedMotion: false, choice: 'auto', pixelRatio: (m = 2) => Math.min(2, m), on: () => noop },
    controls: { set: noop, stick: { x: 0, y: 0 }, pressed: (id) => pressed.has(id), touch },
    ui: { setOrientation: noop, showInvite: noop, setMenuPosition: noop, requestFullscreen: noop },
    player: { get: async () => ({ id: room.me.id, name: room.me.name, guest: true }), avatarUrl: async () => null },
    save: { get: async (k) => saves.get(k) ?? null, set: async (k, v) => void saves.set(k, v), delete: async () => {} },
    badges: { award: async (id) => (awarded.push(id), true) },
    leaderboards: { submit: async () => null },
    on: () => noop,
    _awarded: awarded,
    _saves: saves,
  };
}
