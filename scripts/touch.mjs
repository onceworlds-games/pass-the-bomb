// The phone path by touch, held upright (390x844) and sideways (844x390): taps and drags only, no mouse, no keys.
// Title, the Observatory, a night, a tray card, a cell, the dial, Undo, the sell button, the wave. Checks that the
// whole table is on screen, that every target is at least 44 px, and that a tap lands on the cell under it (the
// table is turned a quarter on a screen held upright). Screenshots in /tmp/glint-touch.
//   node scripts/touch.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const { server, port } = await serve('game');
mkdirSync('/tmp/glint-touch', { recursive: true });
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed++;
};

for (const [w, h] of [[390, 844], [844, 390]]) {
  const b = await launch({ width: w, height: h });
  const errors = [];
  b.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(`ERROR ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 500));
  });
  await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const tag = `${w}x${h}`;
  let n = 0;
  const shot = async (name) => {
    const r = await b.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`/tmp/glint-touch/${tag}-${String(++n).padStart(2, '0')}-${name}.png`, Buffer.from(r.result.data, 'base64'));
  };
  const tap = async (x, y) => {
    await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(40);
    await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(150);
  };
  const drag = async (x0, y0, x1, y1, steps = 10) => {
    await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) {
      await b.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
      await sleep(25);
    }
    await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(150);
  };
  const rectOf = async (sel, text) => {
    for (let i = 0; i < 40; i++) {
      const r = await b.evaluate(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.offsetParent); const el = ${text ? `els.find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height]; })()`);
      if (r) return r;
      await sleep(150);
    }
    throw new Error(`no ${sel} ${text || ''}`);
  };
  // Small targets among the visible buttons of a part of the page.
  const small = (sel) => b.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => !e.hidden && e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return [e.className.split(' ').pop() || e.textContent.trim().slice(0, 12), Math.round(r.width), Math.round(r.height)]; }).filter(([, a, c]) => a < 44 || c < 44)`);
  const cellXY = (c, r) => b.evaluate(`(() => { const p = window.__glint.scene.toScreen((${c} + 0.5) * 64, (${r} + 0.5) * 64); return [p.x, p.y, window.__glint.scene.view.scale]; })()`);

  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
  await sleep(1800);
  await shot('title');
  let r = await rectOf('#screen button', 'Play');
  await tap(r[0], r[1]);
  await sleep(700);
  await shot('observatory');
  check(`${tag} Observatory targets are 44 px`, (await small('#screen button')).length === 0, JSON.stringify(await small('#screen button')));
  r = await rectOf('#screen button', 'Night 1');
  await tap(r[0], r[1]);
  await sleep(1800);
  await shot('dusk');
  check(`${tag} HUD targets are 44 px`, (await small('.hud button')).length === 0, JSON.stringify(await small('.hud button')));
  const view = await b.evaluate(`(() => { const s = window.__glint.scene; const b = s.board; const pts = [[0, 0], [b.w, 0], [0, b.h], [b.w, b.h]].map(([x, y]) => s.toScreen(x, y)); return { rot: s.view.rot, cell: Math.round(64 * s.view.scale), zoom: s.view.zoom, inside: pts.every((p) => p.x >= -1 && p.y >= -1 && p.x <= innerWidth + 1 && p.y <= innerHeight + 1) }; })()`);
  check(`${tag} the whole table is on screen, unzoomed`, view.inside && view.zoom === 1, JSON.stringify(view));
  // A tray card, then a cell on the Lamp's row: the piece lands on that cell.
  r = await rectOf('.hud .card');
  await tap(r[0], r[1]);
  let [x, y, scale] = await cellXY(5, 6);
  await tap(x, y);
  await sleep(300);
  const placed = await b.evaluate('window.__glint.session.night().S.pieces.map((p) => [p.type, p.c, p.r])');
  check(`${tag} a tap places on the cell under it`, placed.length === 1 && placed[0][1] === 5 && placed[0][2] === 6, JSON.stringify(placed));
  await shot('placed');
  // Tap the glass: the dial; drag its handle a quarter turn.
  await tap(x, y);
  await sleep(300);
  await shot('dial');
  const before = await b.evaluate('window.__glint.session.night().S.pieces[0]?.angle');
  const hdl = await b.evaluate(`(() => { const s = window.__glint.scene; const p = window.__glint.session.night().S.pieces[0]; const g = window.__glint.input.dial(p); const a = p.angle * Math.PI / 180 + Math.PI / 2; const h = s.toScreen(g.hx, g.hy); const t = s.toScreen(g.cx + Math.cos(a) * g.R, g.cy + Math.sin(a) * g.R); return [h.x, h.y, t.x, t.y]; })()`);
  await drag(hdl[0], hdl[1], hdl[2], hdl[3], 12);
  await sleep(300);
  const after = await b.evaluate('window.__glint.session.night().S.pieces[0]?.angle');
  check(`${tag} the dial turns the glass`, after !== before, `${before} -> ${after}`);
  await shot('turned');
  // Undo puts the angle back.
  r = await rectOf('.hud .undo');
  await tap(r[0], r[1]);
  await sleep(300);
  check(`${tag} Undo takes the turn back`, (await b.evaluate('window.__glint.session.night().S.pieces[0]?.angle')) === before);
  // The sell button at the ring's upper right on screen.
  await tap(x, y);
  await sleep(250);
  const sellAt = await b.evaluate(`(() => { const s = window.__glint.scene; const p = window.__glint.session.night().S.pieces[0]; const g = window.__glint.input.dial(p); const o = s.toScreen(g.sx, g.sy); return [o.x, o.y]; })()`);
  await tap(sellAt[0], sellAt[1]);
  await sleep(300);
  check(`${tag} the sell button sells`, (await b.evaluate('window.__glint.session.night().S.pieces.length')) === 0);
  // Begin the night by the button and let it run.
  r = await rectOf('.hud .wavebtn');
  await tap(r[0], r[1]);
  await sleep(5000);
  await shot('wave');
  const st = await b.evaluate(`(() => { const N = window.__glint.session.night(); return N ? N.S.phase : null; })()`);
  check(`${tag} the night runs`, st === 'wave' || st === 'break', st);
  check(`${tag} no errors`, errors.length === 0, [...new Set(errors)].slice(0, 5).join(' | '));
  b.close();
  await sleep(300);
}
server.close();
console.log(failed ? `${failed} FAILED (screens in /tmp/glint-touch)` : 'all passed (screens in /tmp/glint-touch)');
process.exit(failed ? 1 : 0);
