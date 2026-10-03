// The phone path by touch: a 390x844 portrait screen, taps and drags only (no mouse, no keys). Title, the
// Observatory, a night, a tray card, a cell, the dial, the sell button, zoom. Screenshots in /tmp/glint-touch.
//   node scripts/touch.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const { server, port } = await serve('game');
const b = await launch({ width: 390, height: 844 });
const errors = [];
b.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(`ERROR ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 500));
});
await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
mkdirSync('/tmp/glint-touch', { recursive: true });
let n = 0;
const shot = async (name) => {
  const r = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`/tmp/glint-touch/${String(++n).padStart(2, '0')}-${name}.png`, Buffer.from(r.result.data, 'base64'));
};
const tap = async (x, y) => {
  await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(40);
  await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
};
const drag = async (x0, y0, x1, y1, steps = 8) => {
  await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await b.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
    await sleep(25);
  }
  await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
};
const rectOnce = async (sel, text) => b.evaluate(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${text ? `els.find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height]; })()`);
const rectOf = async (sel, text) => {
  for (let i = 0; i < 30; i++) {
    const r = await rectOnce(sel, text);
    if (r) return r;
    await sleep(100);
  }
  const seen = await b.evaluate(`(document.getElementById('screen').textContent || '').slice(0, 200)`);
  throw new Error(`no ${sel} ${text || ''}; screen says: ${seen}`);
};
const cellXY = async (c, r) => b.evaluate(`(() => { const v = window.__glint.scene.view; return [v.ox + (${c} + 0.5) * 64 * v.scale, v.oy + (${r} + 0.5) * 64 * v.scale, v.scale]; })()`);

await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
await sleep(1500);
await shot('title');
let r = await rectOf('#screen button', 'Play');
await tap(r[0], r[1]);
await sleep(500);
await shot('observatory');
r = await rectOf('#screen button', 'Night 1');
await tap(r[0], r[1]);
await sleep(1200);
await shot('dusk');
// Every target is at least 44 px.
const small = await b.evaluate(`(() => [...document.querySelectorAll('.hud button')].filter((e) => !e.hidden && e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return [e.className.split(' ').pop(), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44))()`);
console.log('targets under 44px:', JSON.stringify(small));
// Tray card 1, then a cell on the lamp's row.
r = await rectOf('.hud .card');
await tap(r[0], r[1]);
let [x, y, scale] = await cellXY(5, 6);
await tap(x, y);
await sleep(300);
await shot('placed');
// Tap the glass: the dial; drag its handle a quarter turn; then the sell button.
await tap(x, y);
await sleep(300);
await shot('dial');
const h = 58 * scale;
await drag(x + h * Math.cos(Math.PI / 4), y + h * Math.sin(Math.PI / 4), x + h * Math.cos(Math.PI * 0.75), y + h * Math.sin(Math.PI * 0.75), 10);
await sleep(300);
const angle = await b.evaluate('window.__glint.session.night().S.pieces[0]?.angle');
console.log('angle after the dial', angle, 'scale', scale.toFixed(2));
await shot('turned');
await tap(x + 58 * 0.95 * scale, y - 58 * 0.95 * scale);
await sleep(300);
const left = await b.evaluate('window.__glint.session.night().S.pieces.length');
console.log('pieces after sell', left);
// Zoom in, pan by dragging empty felt, zoom out.
r = await rectOf('.hud .zoom button', '+');
await tap(r[0], r[1]);
await sleep(200);
await shot('zoomed');
[x, y] = await cellXY(14, 3);
await drag(x, y, x - 120, y + 60, 8);
await sleep(200);
r = await rectOf('.hud .zoom button', '−');
await tap(r[0], r[1]);
// Begin the night by the button and let it run.
r = await rectOf('.hud .wavebtn');
await tap(r[0], r[1]);
await sleep(6000);
await shot('wave');
const state = await b.evaluate(`(() => { const N = window.__glint.session.night(); return N ? { phase: N.S.phase, heart: N.S.heart.hp, t: Math.round(N.S.t) } : null; })()`);
console.log('state', state);
console.log(errors.length ? `ERRORS (${errors.length}):\n${[...new Set(errors)].slice(0, 30).join('\n')}` : 'no errors');
b.close();
server.close();
process.exit(errors.length ? 1 : 0);
