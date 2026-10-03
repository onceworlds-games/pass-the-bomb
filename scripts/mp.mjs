// Three guests on the local platform: the title, the lobby, a night, a guest's glass and lies, Undo, a reload of a
// guest and of the host, a dropped connection, the change of host, the old host back as a player, and a fourth
// friend who arrives mid-night and watches. Screens in /tmp/glint-mp.
//   node scripts/mp.mjs   (after deploying the folder to the local platform)
import { launch } from '/Users/gowravthota/Desktop/commit/onceworlds-games/_tools/mp-lib.mjs';
import { mkdirSync } from 'node:fs';
const OUT = '/tmp/glint-mp';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:8787';
const mp = await launch({ players: 4, base });
const P = mp.players;
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed++;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) return false;
    await sleep(300);
  }
};
const R = (expr) => `(() => { const r = onceworlds.rooms.current; return ${expr}; })()`;
const phase = (p) => p.frame(R(`r ? r.match.phase : 'none'`));
const hud = (p) => p.frame(`(() => { const h = document.querySelector('.hud .topbar'); return h && !document.getElementById('hud').hidden ? h.textContent.replace(/\\s+/g, ' ').trim() : 'screen:' + (document.getElementById('screen').className || '') + ' ' + (document.querySelector('#screen .nameplate')?.textContent || ''); })()`);
const meta = (p) => p.frame(R(`(() => { const n = r && r.state.night; return n ? { ph: n.meta.phase, wave: n.meta.wave, t: n.meta.t, pieces: (r.state.pieces || []).length, mid: n.mid === r.match.id } : null; })()`));
const clickText = (p, text) => p.frame(`(() => { const b = [...document.querySelectorAll('#screen button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (b) { b.click(); return true; } return false; })()`);
const cmd = (p, c) => p.frame(R(`(r.send({ t: 'cmd', seq: ${Math.floor(Math.random() * 1e6)}, cmd: ${JSON.stringify(c)} }, { to: r.host }), true)`));
const hostIndex = async () => {
  const ids = await Promise.all(P.slice(0, 3).map((p) => p.frame(R('r.me.id'))));
  const h = await P[0].frame(R('r.host'));
  return ids.indexOf(h);
};
try {
  await P[0].open('/play/glint');
  const code = new URL(await P[0].top('location.href')).searchParams.get('server');
  await Promise.all(P.slice(1, 3).map((p) => p.open(`/play/glint?server=${code}`)));
  check('three at the table', await until(async () => (await Promise.all(P.slice(0, 3).map((p) => p.frame(R('r.players.size'))))).every((n) => n === 3)));
  check('title shows one Play over the table', await until(async () => (await P[1].frame(`document.querySelectorAll('#screen.title button').length === 1 && !!document.querySelector('#screen .wordmark')`))));
  for (const p of P.slice(0, 3)) await clickText(p, 'Play');
  check('everyone in the Observatory', await until(async () => (await Promise.all(P.slice(0, 3).map(hud))).every((h) => /Observatory/.test(h))));
  await P[1].shot(`${OUT}/mp-lobby-guest.png`);
  const roles = await until(async () => { const r = await P[1].frame(R('JSON.stringify([...r.players.values()].map((p) => p.presence && p.presence.role))')); return JSON.parse(r).every((x) => x) ? r : false; }, 8000);
  check("every Optician's role reaches the others", !!roles, roles || await P[1].frame(R('JSON.stringify([...r.players.values()].map((p) => [p.id.slice(0,4), p.presence]))')));
  let h = await hostIndex();
  check('a host', h >= 0, `index ${h}`);
  for (let i = 0; i < 3; i++) if (i !== h) await P[i].frame(R('r.setReady(true)'));
  check('host can start once the others are ready', await until(() => P[h].frame(R('r.canStart'))));
  await P[h].frame(R('r.startMatch()'));
  check('the night begins everywhere', await until(async () => (await Promise.all(P.slice(0, 3).map(phase))).every((x) => x === 'playing'), 15000));
  check('every page shows the night HUD', await until(async () => (await Promise.all(P.slice(0, 3).map(hud))).every((x) => /Night 1/.test(x)), 10000));
  const g = (h + 1) % 3;
  const third = (h + 2) % 3;
  await cmd(P[g], { op: 'place', type: 'mirror', c: 5, r: 3, angle: 45 });
  check("a guest's glass reaches every table", await until(async () => (await Promise.all(P.slice(0, 3).map(meta))).every((m) => m && m.pieces === 1 && m.mid)));
  await cmd(P[g], { op: 'place', type: 'laser', c: 'x', r: NaN, angle: 1e99 });
  await P[g].frame(R(`r.send({ t: 'snap', seq: 99, shades: [[1, 'dragon']] })`));
  await P[g].frame(R(`r.send({ t: 'ev', list: [{ k: 'kill', x: 1e12 }] })`));
  await sleep(800);
  check('lies change nothing', (await Promise.all(P.slice(0, 3).map(meta))).every((m) => m && m.pieces === 1));
  // Undo by a guest takes their glass back.
  await cmd(P[g], { op: 'undo' });
  check("a guest's Undo is honoured", await until(async () => (await meta(P[h]))?.pieces === 0));
  await cmd(P[g], { op: 'place', type: 'mirror', c: 5, r: 3, angle: 45 });
  await P[h].frame(`document.querySelector('.hud .wavebtn').click()`);
  check('the wave starts', await until(async () => (await meta(P[g]))?.ph === 'wave'));
  await sleep(2500);
  await P[g].shot(`${OUT}/mp-wave-guest.png`);
  // Reload the guest mid-wave.
  await P[g].reload();
  await P[g].passName(undefined, 20000);
  check('a reloaded guest is back in the night', await until(async () => (await phase(P[g])) === 'playing' && /Night 1/.test(await hud(P[g])), 20000));
  // Drop a socket.
  await P[third].dropSocket();
  check('a dropped player comes back', await until(async () => (await P[third].frame(R('r.connected'))) === true && (await phase(P[third])) === 'playing', 20000));
  // Reload the host.
  const before = await meta(P[g]);
  const oldHost = await P[0].frame(R('r.host'));
  await P[h].reload();
  await P[h].passName(undefined, 20000);
  check('the host role moves', await until(async () => (await P[g].frame(R('r.host'))) !== oldHost, 15000));
  check('the night carries on under the new host', await until(async () => { const m = await meta(P[g]); return m && m.pieces === before.pieces && m.mid && m.t > before.t + 1; }, 15000));
  const back = await until(async () => (await phase(P[h])) === 'playing' && /Night 1/.test(await hud(P[h])), 20000);
  check('the old host is back as a player', back, back ? '' : `${await phase(P[h])} | ${await hud(P[h])} | spect ${await P[h].frame(R('r.spectating'))} | part ${await P[h].frame(R('JSON.stringify(r.match.participants)'))} me ${await P[h].frame(R('r.me.id'))}`);
  await P[h].shot(`${OUT}/mp-oldhost.png`);
  // A fourth friend arrives mid-night: watches.
  await P[3].open(`/play/glint?server=${code}`);
  await clickText(P[3], 'Play');
  check('a latecomer watches', await until(async () => (await P[3].frame(R('r.spectating'))) === true && /screen watching/.test(await hud(P[3])), 15000));
  await P[3].shot(`${OUT}/mp-watching.png`);
  const errs = P.map((p) => p.errors.length);
  check('no uncaught errors', errs.every((n) => n === 0), errs.join(','));
  const warn = await Promise.all(P.map((p) => p.logs.filter((l) => /waiting|dropped/.test(l)).length));
  check('no message budget warnings', warn.every((n) => n === 0), warn.join(','));
} catch (e) {
  console.error('script error', e);
  failed++;
} finally {
  for (const p of P) for (const e of p.errors.slice(0, 4)) console.log('  err', e.slice(0, 300));
  for (const p of P) for (const l of p.logs.slice(0, 4)) console.log('  log', l.slice(0, 200));
  await mp.close();
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
