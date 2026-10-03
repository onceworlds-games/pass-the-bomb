// The one place the game touches the platform SDK. Everything here is guarded: the SDK is absent in poster
// mode and in tests, a method may be missing on an older platform, and a failure must never reach the frame loop.

const ow = typeof window !== 'undefined' ? window.onceworlds : null;
const memory = new Map();
const warn = (what, e) => {
  try {
    console.warn(`[glint] ${what}`, e && e.message ? e.message : e);
  } catch {}
};

export const platform = {
  present: !!ow,

  async player() {
    try {
      if (ow?.player?.get) {
        const p = await ow.player.get();
        if (p && typeof p.id === 'string') return { id: p.id, name: cleanName(p.name), guest: !!p.guest };
      }
    } catch (e) {
      warn('player', e);
    }
    return { id: 'local', name: 'Optician', guest: true };
  },

  async avatar(id, kind = 'head') {
    try {
      if (ow?.player?.avatarUrl) return (await ow.player.avatarUrl(id, kind)) || null;
    } catch (e) {
      warn('avatar', e);
    }
    return null;
  },

  async join(opts) {
    if (ow?.rooms?.join) {
      try {
        const room = await ow.rooms.join(opts);
        if (room) return room;
      } catch (e) {
        warn('join', e);
      }
    }
    return makeSoloRoom();
  },

  save: {
    async get(key) {
      try {
        if (ow?.save?.get) return await ow.save.get(key);
      } catch (e) {
        warn('save.get', e);
      }
      return memory.has(key) ? memory.get(key) : null;
    },
    async set(key, value) {
      memory.set(key, value);
      try {
        if (ow?.save?.set) await ow.save.set(key, value);
      } catch (e) {
        warn('save.set', e);
      }
    },
  },

  badges: {
    async award(id) {
      try {
        if (ow?.badges?.award) return (await ow.badges.award(id)) === true;
      } catch (e) {
        warn('badge', e);
      }
      return false;
    },
  },

  leaderboards: {
    async submit(name, score, opts) {
      try {
        if (ow?.leaderboards?.submit && Number.isFinite(score)) return await ow.leaderboards.submit(name, Math.round(score), opts);
      } catch (e) {
        warn('leaderboard', e);
      }
      return null;
    },
  },

  settings: {
    get quality() {
      try {
        return ow?.settings?.quality || 'high';
      } catch {
        return 'high';
      }
    },
    get choice() {
      try {
        return ow?.settings?.choice || 'auto';
      } catch {
        return 'auto';
      }
    },
    get reducedMotion() {
      try {
        if (ow?.settings) return !!ow.settings.reducedMotion;
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    },
    pixelRatio(max = 2) {
      try {
        if (ow?.settings?.pixelRatio) {
          const v = ow.settings.pixelRatio(max);
          if (Number.isFinite(v) && v > 0) return v;
        }
      } catch {}
      const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
      return Math.min(dpr, max);
    },
    onChange(fn) {
      try {
        ow?.settings?.on?.('change', fn);
      } catch (e) {
        warn('settings.on', e);
      }
    },
  },

  controls: {
    clear() {
      try {
        ow?.controls?.set?.(null);
      } catch {}
    },
    get touch() {
      try {
        return !!ow?.controls?.touch;
      } catch {
        return false;
      }
    },
  },

  ui: {
    showInvite() {
      try {
        ow?.ui?.showInvite?.();
      } catch {}
    },
    setMenuPosition(where) {
      try {
        ow?.ui?.setMenuPosition?.(where);
      } catch {}
    },
  },

  now() {
    try {
      if (ow?.now) {
        const v = ow.now();
        if (Number.isFinite(v)) return v;
      }
    } catch {}
    return Date.now();
  },

  on(event, fn) {
    try {
      ow?.on?.(event, fn);
    } catch {}
  },
};

export function cleanName(name) {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return (s || 'Optician').slice(0, 24);
}

/**
 * A room for one: what rooms.join() gives when there is no platform (poster mode, a local file, tests).
 * Same surface the game uses, same event names, so the session code never asks which it has.
 */
export function makeSoloRoom() {
  const me = { id: 'local', name: 'Optician', presence: {}, team: 0, connected: true, ready: false };
  const listeners = new Map();
  const players = new Map([[me.id, me]]);
  const state = {};
  let n = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let paused = false;
  let pausedAt = 0;
  let pausedTotal = 0;
  const match = { phase: 'lobby', n: 0, min: 1, id: null, seed: 0, participants: [], startsAt: 0, startedAt: 0, paused: false, waitUntil: 0 };
  const emit = (ev, ...args) => {
    for (const fn of listeners.get(ev) || []) {
      try {
        fn(...args);
      } catch (e) {
        warn(`solo ${ev}`, e);
      }
    }
  };
  const room = {
    kind: 'solo',
    me,
    players,
    get online() {
      return players;
    },
    host: me.id,
    isHost: true,
    connected: true,
    state,
    invite: null,
    teams: 0,
    match,
    get participants() {
      return match.phase === 'playing' ? [me] : [];
    },
    spectators: [],
    spectating: false,
    get running() {
      return match.phase === 'playing' && !paused;
    },
    leftOut: [],
    settings: {},
    private: {},
    budget: { messagesPerSecond: 60, presenceHz: 20, bytesPerSecond: 131072 },
    allReady: true,
    notReady: [],
    canStart: true,
    isParticipant: (id) => match.phase === 'playing' && id === me.id,
    matchNow: () => (match.phase === 'playing' ? Math.max(0, now() - match.startedAt - pausedTotal - (paused ? now() - pausedAt : 0)) : 0),
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    off(ev, fn) {
      const l = listeners.get(ev);
      if (l) listeners.set(ev, l.filter((f) => f !== fn));
    },
    startMatch() {
      if (match.phase === 'playing') return;
      n++;
      match.phase = 'playing';
      match.n = n;
      match.id = `solo-${n}-${Math.floor(Math.random() * 1e9).toString(36)}`;
      match.seed = Math.floor(Math.random() * 2 ** 31);
      match.participants = [me.id];
      match.startsAt = now();
      match.startedAt = now();
      paused = false;
      pausedTotal = 0;
      emit('starting', match);
      emit('matchstart', match);
      emit('match', match, { phase: 'lobby' });
    },
    endMatch() {
      if (match.phase !== 'playing') return;
      const previous = { ...match };
      match.phase = 'lobby';
      match.participants = [];
      emit('matchend', match, previous);
      emit('match', match, previous);
    },
    pauseMatch(flag = true) {
      if (match.phase !== 'playing' || paused === !!flag) return;
      paused = !!flag;
      if (paused) {
        pausedAt = now();
        emit('matchpause', match);
      } else {
        pausedTotal += now() - pausedAt;
        emit('matchresume', match);
      }
    },
    setState(key, value) {
      if (value === null || value === undefined) delete state[key];
      else state[key] = value;
    },
    setPresence(p) {
      me.presence = p;
    },
    presenceAt(id) {
      return players.get(id)?.presence || null;
    },
    send() {},
    setReady() {},
    clearReady() {},
    admit() {},
    setOpen() {},
    hideLobby() {},
    setPrivate(key, value) {
      if (value == null) delete room.private[key];
      else room.private[key] = value;
    },
    setPrivateFor() {},
    privateOf() {
      return room.private;
    },
    kick() {},
    transferHost() {},
    leave() {},
  };
  return room;
}
