// Clicks through the game standalone like a player would (title, the Observatory, a night, placing and turning
// glass, a Flare, the dial, selling) and screenshots the steps. Reports console errors.
//   node scripts/drive.mjs            screenshots in /tmp/glint-drive
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const { server, port } = await serve('game');
const b = await launch({ width: 1100, height: 760 });
const errors = [];
b.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(`ERROR ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 500));
});
mkdirSync('/tmp/glint-drive', { recursive: true });
let n = 0;
const shot = async (name) => {
  const r = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`/tmp/glint-drive/${String(++n).padStart(2, '0')}-${name}.png`, Buffer.from(r.result.data, 'base64'));
};
const click = async (x, y) => {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const drag = async (x0, y0, x1, y1, steps = 8) => {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
  for (let i = 1; i <= steps; i++) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, button: 'left' });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
};
const key = async (k) => {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
};
const clickText = async (text) => {
  const r = await b.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  if (!r) throw new Error(`no button ${text}`);
  await click(r[0], r[1]);
};
const cellXY = async (c, r) => b.evaluate(`(() => { const p = window.__glint.scene.toScreen((${c} + 0.5) * 64, (${r} + 0.5) * 64); return [p.x, p.y]; })()`);

await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?debug` });
await sleep(1500);
await shot('title');
await clickText('Play');
await sleep(600);
await shot('observatory');
await clickText('Night 1');
await sleep(1200);
await shot('dusk');
// Place a mirror: tray card 1, then a cell on the lamp's row.
await key('1');
let [x, y] = await cellXY(5, 6);
await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
await sleep(200);
await shot('ghost');
await click(x, y);
await sleep(300);
// Select it and turn the dial.
await click(x, y);
await sleep(200);
await shot('selected');
const v = await b.evaluate('window.__glint.scene.view.scale');
const ring = Math.max(58 * v, 66); // the dial keeps a screen size
await drag(x + ring * Math.cos(Math.PI / 4), y + ring * Math.sin(Math.PI / 4), x + ring * Math.cos(Math.PI / 2), y + ring * Math.sin(Math.PI / 2), 6);
await sleep(300);
await shot('turned');
await key('e');
await key('e');
await sleep(200);
// Begin the night, let it run, use a flare.
await key(' ');
await sleep(9000);
await key('f');
await sleep(600);
await shot('wave');
await sleep(12000);
await shot('wave-later');
const state = await b.evaluate(`(() => { const N = window.__glint.session.night(); return N ? { phase: N.S.phase, wave: N.S.wave, heart: N.S.heart.hp, kills: N.S.stats.kills, pieces: N.S.pieces.length, angle: N.S.pieces[0]?.angle } : null; })()`);
console.log('state', state);
console.log(errors.length ? `ERRORS (${errors.length}):\n${[...new Set(errors)].slice(0, 30).join('\n')}` : 'no errors');
b.close();
server.close();
process.exit(errors.length ? 1 : 0);
