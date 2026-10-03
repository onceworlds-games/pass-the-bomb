// Loads the game standalone in headless Chrome, lets ?test drive it through a night, and reports every
// console error and uncaught exception. Screenshots at two sizes.
//   node scripts/smoke.mjs [seconds=40] [--shots]
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const secs = Number(process.argv[2] || 40);
const shots = process.argv.includes('--shots');
const { server, port } = await serve('game');
const b = await launch({ width: 1100, height: 760 });
const errors = [];
b.on((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(`EXC ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    errors.push(`${msg.params.type.toUpperCase()} ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 600));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`LOG ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
});
await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test` });
const t0 = Date.now();
let lastLine = '';
mkdirSync('/tmp/glint-smoke', { recursive: true });
while (Date.now() - t0 < secs * 1000) {
  await sleep(1000);
  const line = await b.evaluate(`(() => { const h = document.querySelector('.hud .topbar'); return h ? h.textContent.replace(/\\s+/g, ' ').trim() : document.getElementById('screen')?.textContent?.slice(0, 60) || 'no hud'; })()`);
  const s = typeof line === 'string' ? line : JSON.stringify(line);
  if (s !== lastLine) {
    console.log(`${Math.round((Date.now() - t0) / 1000)}s  ${s}`);
    lastLine = s;
  }
  if (shots && Date.now() - t0 > 12000 && !globalThis.__shot1) {
    globalThis.__shot1 = true;
    const r = await b.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('/tmp/glint-smoke/desktop.png', Buffer.from(r.result.data, 'base64'));
  }
}
if (shots) {
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(1500);
  const r = await b.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('/tmp/glint-smoke/phone.png', Buffer.from(r.result.data, 'base64'));
  console.log('shots in /tmp/glint-smoke');
}
console.log(errors.length ? `ERRORS (${errors.length}):\n${[...new Set(errors)].slice(0, 40).join('\n')}` : 'no errors');
b.close();
server.close();
process.exit(errors.some((e) => e.startsWith('EXC') || e.startsWith('ERROR')) ? 1 : 0);
