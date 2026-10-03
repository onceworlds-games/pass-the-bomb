// Three guests on the local platform: the lobby, a night, a guest's command, a reload of each role, a dropped
// connection and a change of host. Every step checks nothing threw and that the pages agree.
//   node scripts/mp.mjs [--base http://localhost:8787]
import { launch } from '/Users/gowravthota/Desktop/commit/onceworlds-games/_tools/mp-lib.mjs';

const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mp = await launch({ players: 3, base });
const P = mp.players;
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed++;
};
const phase = (p) => p.frame(`(() => { const r = onceworlds.rooms.current; return r ? r.match.phase : 'none'; })()`);
const hudText = (p) => p.frame(`(() => { const h = document.querySelector('.hud .topbar'); return h && !document.getElementById('hud').hidden ? h.textContent.replace(/\\s+/g, ' ').trim() : (document.getElementById('screen').textContent || '').slice(0, 50); })()`);
const nightMeta = (p) => p.frame(`(() => { const r = onceworlds.rooms.current; const n = r && r.state.night; return n ? { phase: n.meta.phase, wave: n.meta.wave, pieces: (r.state.pieces || []).length, mid: n.mid === r.match.id } : null; })()`);
const clickPlay = (p) => p.frame(`(() => { const b = [...document.querySelectorAll('#screen button')].find((x) => /^Play$/.test(x.textContent.trim())); if (b) { b.click(); return true; } return false; })()`);
const errorsOf = () => P.map((p, i) => `${i}:${p.errors.length}`).join(' ');

try {
  await P[0].open('/play/glint');
  const url = await P[0].top('location.href');
  const code = new URL(url).searchParams.get('server');
  check('private server code', !!code, code);
  await Promise.all(P.slice(1).map((p) => p.open(`/play/glint?server=${code}`)));
  await sleep(1500);
  const sizes = await Promise.all(P.map((p) => p.frame('onceworlds.rooms.current.players.size')));
  check('three at the table', sizes.every((s) => s === 3), sizes.join(','));
  for (const p of P) await clickPlay(p);
  await sleep(800);
  // Everyone but the host readies; the host starts.
  const host = await P[0].frame('onceworlds.rooms.current.host');
  const hostIndex = (await Promise.all(P.map((p) => p.frame('onceworlds.rooms.current.me.id')))).indexOf(host);
  check('host is known', hostIndex >= 0, `index ${hostIndex}`);
  for (let i = 0; i < 3; i++) if (i !== hostIndex) await P[i].frame('onceworlds.rooms.current.setReady(true)');
  await sleep(600);
  const canStart = await P[hostIndex].frame('onceworlds.rooms.current.canStart');
  check('host can start once others are ready', canStart === true);
  await P[hostIndex].frame('onceworlds.rooms.current.startMatch()');
  await sleep(4500);
  const phases = await Promise.all(P.map(phase));
  check('match playing everywhere', phases.every((x) => x === 'playing'), phases.join(','));
  const huds = await Promise.all(P.map(hudText));
  check('every page shows the night HUD', huds.every((h) => /Night 1/.test(h)), huds.map((h) => h.slice(0, 20)).join(' | '));
  // A guest places a mirror through the host.
  const guest = (hostIndex + 1) % 3;
  await P[guest].frame(`onceworlds.rooms.current.send({ t: 'cmd', seq: 1, cmd: { op: 'place', type: 'mirror', c: 5, r: 6, angle: 45 } }, { to: onceworlds.rooms.current.host })`);
  await sleep(1200);
  let metas = await Promise.all(P.map(nightMeta));
  check('the guest\'s mirror is on every table', metas.every((m) => m && m.pieces === 1 && m.mid), JSON.stringify(metas));
  // A lying guest: a bad cell, a bad type, NaN.
  await P[guest].frame(`onceworlds.rooms.current.send({ t: 'cmd', seq: 2, cmd: { op: 'place', type: 'laser', c: 'x', r: NaN, angle: 1e99 } }, { to: onceworlds.rooms.current.host })`);
  await P[guest].frame(`onceworlds.rooms.current.send({ t: 'snap', seq: 99, shades: [[1, 'dragon']] })`);
  await sleep(800);
  metas = await Promise.all(P.map(nightMeta));
  check('garbage changed nothing', metas.every((m) => m && m.pieces === 1), JSON.stringify(metas));
  // Begin the night from the host, then reload the guest mid-wave.
  await P[hostIndex].frame(`document.querySelector('.hud .wavebtn').click()`);
  await sleep(2500);
  await P[guest].reload();
  await sleep(4000);
  const guestPhase = await phase(P[guest]);
  const guestHud = await hudText(P[guest]);
  check('reloaded guest is back in the night', guestPhase === 'playing' && /Night 1/.test(guestHud), `${guestPhase} ${guestHud.slice(0, 30)}`);
  // Drop the third player's socket.
  const third = (hostIndex + 2) % 3;
  await P[third].dropSocket();
  await sleep(5000);
  check('dropped player reconnected', (await phase(P[third])) === 'playing');
  // Reload the host: the role moves and the night goes on.
  const metaBefore = await nightMeta(P[guest]);
  await P[hostIndex].reload();
  await sleep(5000);
  const newHost = await P[guest].frame('onceworlds.rooms.current.host');
  check('host moved to another page', newHost !== host, `${host} -> ${newHost}`);
  const metaAfter = await nightMeta(P[guest]);
  check('the night carried on under the new host', metaAfter && metaAfter.pieces === metaBefore.pieces && metaAfter.mid, JSON.stringify(metaAfter));
  const oldHostPhase = await phase(P[hostIndex]);
  check('old host is back as a player', oldHostPhase === 'playing');
  await sleep(3000);
  const huds2 = await Promise.all(P.map(hudText));
  check('all three still show the night', huds2.every((h) => /Night 1/.test(h)), huds2.map((h) => h.slice(0, 24)).join(' | '));
  const dropped = await Promise.all(P.map((p) => p.logs.filter((l) => /waiting|dropped/.test(l)).length));
  check('no message budget warnings', dropped.every((n) => n === 0), dropped.join(','));
} catch (e) {
  console.error('script error', e);
  failed++;
} finally {
  console.log('errors per page', errorsOf());
  for (const p of P) for (const e of p.errors.slice(0, 5)) console.log('  ', e.slice(0, 300));
  for (const p of P) for (const l of p.logs.slice(0, 5)) console.log('  log', l.slice(0, 200));
  await mp.close();
}
process.exit(failed ? 1 : 0);
