// Store art, drawn by the game itself with the real renderer: open the page with ?poster=<name> and it paints one staged,
// frozen picture at the poster's exact size, then sets document.body.dataset.ready = '1'. It never touches the SDK or a room.
//   cover (1280x720)  action (1280x720)  win (1280x720)  icon (512x512)  badge-<id> (256x256)

import { rng } from './rules.js';
import { mapOf } from './maps.js';
import { createFx } from './fx.js';
import { makeView, paintBackground, drawWorld, drawFigure, drawBomb, newFig, text, iconCrown, iconFlame, iconStopwatch, iconBombSmall, iconStar, INK, FONT, shade } from './draw.js';
import { drawPodium } from './ui.js';

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };
const BADGES = {
  'first-win': { color: '#ffb703', symbol: 'crown' },
  'hot-hands': { color: '#ff5a2a', symbol: 'flame' },
  'close-call': { color: '#38a8ff', symbol: 'stopwatch' },
  'bomb-squad': { color: '#9b5cff', symbol: 'bomb' },
};
const T = 1.3; // the moment in time every poster is drawn at

function fig(id, o) {
  return Object.assign(newFig(id), { bot: true, popT: 1 }, o);
}

export async function runPoster(name, canvas) {
  let w = 1280;
  let h = 720;
  let badge = null;
  if (name.startsWith('badge-')) {
    badge = BADGES[name.slice(6)] ?? { color: '#ffd21f', symbol: 'crown' };
    w = h = 256;
  } else if (SIZES[name]) [w, h] = SIZES[name];
  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = `display:block;position:fixed;left:0;top:0;width:${w}px;height:${h}px`;
  document.documentElement.style.overflow = 'hidden';
  try {
    await document.fonts.load('100px "Luckiest Guy"', 'PASS THE BOMB 123');
    await document.fonts.ready;
  } catch {
    // the fallback font still draws
  }
  const cx = canvas.getContext('2d');
  cx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    if (badge) drawBadge(cx, badge);
    else if (name === 'icon') drawIcon(cx);
    else if (name === 'action') drawAction(cx);
    else if (name === 'win') drawWin(cx);
    else drawCover(cx);
    document.body.dataset.ready = '1';
  } catch (err) {
    document.body.dataset.error = String(err && err.message ? err.message : err);
    throw err;
  }
}

function drawCover(cx) {
  const v = makeView(1280, 720, 1, { top: 64, bottom: 8 });
  const map = mapOf('backyard');
  const fx = createFx(rng(11));
  fx.setQuality('high', false);
  paintBackground(cx, v, map);
  const holder = fig('a', { x: 9.6, y: 9.2, vx: 15, vy: 1.6, dash: true, hold: true, heat: 1, c: 0, run: 1.2, sx: 0.94, sy: 1.08 });
  const figs = [
    holder,
    fig('b', { x: 13.6, y: 9.9, vx: 5.4, vy: 0.8, c: 6, run: 2.4, sx: 0.96, sy: 1.05 }),
    fig('c', { x: 12.8, y: 11.7, vx: 4.6, vy: 2.0, c: 2, run: 0.4, sx: 0.96, sy: 1.05, imm: false }),
    fig('d', { x: 4.6, y: 6.0, vx: -3.6, vy: 1.0, c: 4, run: 3.1 }),
    fig('e', { x: 7.4, y: 7.4, vx: -3.0, vy: -1.5, c: 8, run: 5.0 }),
    fig('f', { x: 18.8, y: 6.8, vx: 4.2, vy: -2.0, c: 1, run: 2.0 }),
    fig('g', { x: 20.6, y: 9.2, vx: 5.0, vy: 3.0, c: 9, run: 0.9 }),
    fig('h', { x: 16.4, y: 5.8, vx: 3.2, vy: -3.0, c: 5, run: 4.2 }),
  ];
  for (const f of figs) f.name = '';
  // dust behind the runners, sparks round the bomb
  for (let i = 0; i < 6; i++) fx.dust(holder.x - 0.8 - i * 0.55, holder.y + 0.1, -3, 0);
  for (const f of figs.slice(1)) fx.dust(f.x - 0.5, f.y, -1.5, 0);
  fx.sparks(holder.x + 0.5, holder.y, 3.1, 8, '#ffd21f', 1);
  for (let i = 0; i < 3; i++) fx.update(0.05);
  const bombs = [{ x: holder.x, y: holder.y, z: 2.4, scale: 1.12, flash: 0.1, fuse: 0.4, fall: -1 }];
  drawWorld(cx, v, map, { figs, bombs, fx }, T);
  // the name, big and chunky in the top third
  cx.save();
  cx.translate(640, 62);
  cx.rotate(-0.03);
  cx.font = `124px ${FONT}`;
  const w1 = cx.measureText('PASS THE ').width;
  const w2 = cx.measureText('BOMB').width;
  const x0 = -(w1 + w2) / 2;
  text(cx, 'PASS THE ', x0, 0, 124, { align: 'left', width: 24 });
  text(cx, 'BOMB', x0 + w1, 0, 124, { align: 'left', fill: '#ff5a2a', width: 24 });
  cx.restore();
}

function drawAction(cx) {
  const s = 100;
  const v = { W: 1280, H: 720, pr: 1, s, ox: 640 - 15.2 * s, oy: 380 - 8.0 * s, top: 0, lw: 5.5 };
  const map = mapOf('backyard');
  const fx = createFx(rng(23));
  fx.setQuality('high', false);
  paintBackground(cx, v, map);
  // the glare of the blast
  const grad = cx.createRadialGradient(640, 320, 20, 640, 320, 380);
  grad.addColorStop(0, 'rgba(255,240,150,0.85)');
  grad.addColorStop(0.5, 'rgba(255,170,60,0.35)');
  grad.addColorStop(1, 'rgba(255,170,60,0)');
  cx.fillStyle = grad;
  cx.fillRect(0, 0, 1280, 720);
  const sooty = fig('s', { x: 15.2, y: 8.0, z: 2.1, rot: 0.55, soot: 1, fly: 0.3, c: 3, name: '' });
  const figs = [
    sooty,
    fig('t', { x: 11.5, y: 9.9, vx: -5.5, vy: 1.5, c: 7, run: 1.1, sx: 0.95, sy: 1.06 }),
    fig('u', { x: 19.4, y: 6.2, vx: 5.0, vy: -2.4, c: 1, run: 3.3, sx: 0.95, sy: 1.06 }),
    fig('w', { x: 13.0, y: 5.5, vx: -2.0, vy: -4.0, c: 5, run: 2.2, stun: true }),
  ];
  fx.explosion(15.2, 8.0);
  fx.explosion(15.2, 8.0);
  fx.ring(15.2, 8.0, 0.9, 3.4, '#ffffff', 0.5);
  for (let i = 0; i < 3; i++) fx.update(0.045);
  drawWorld(cx, v, map, { figs, bombs: [], fx }, T);
}

function drawWin(cx) {
  const v = makeView(1280, 720, 1, { top: 0, bottom: 0 });
  const map = mapOf('backyard');
  const fx = createFx(rng(37));
  fx.setQuality('high', false);
  paintBackground(cx, v, map);
  drawWorld(cx, v, map, { figs: [], bombs: [], fx: null }, T);
  const head = (id, c) => fig(id, { c, name: '' });
  drawPodium(cx, v, { top: [{ f: head('p1', 0), name: '', score: '' }, { f: head('p2', 6), name: '', score: '' }, { f: head('p3', 3), name: '', score: '' }], place: -1, awards: { potato: null, slippery: null } }, 4);
  for (let i = 0; i < 14; i++) fx.confetti(2.5 + (i * 19) / 14, 5 + (i % 3) * 1.6, 16, 5, 7 + (i % 4));
  for (let i = 0; i < 6; i++) fx.update(0.07);
  fx.draw(cx, v);
}

function drawIcon(cx) {
  const g = cx.createRadialGradient(256, 230, 40, 256, 256, 340);
  g.addColorStop(0, '#6bd05a');
  g.addColorStop(1, '#2f9a45');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 512, 512);
  // a few stars of confetti in the corners of the picture, kept away from the edge
  for (const [x, y, r, c] of [[110, 130, 16, '#ffd21f'], [405, 150, 13, '#ffffff'], [90, 330, 12, '#ffffff'], [420, 340, 17, '#ffd21f']]) iconStar(cx, x, y, r, c);
  const s = 104;
  const v = { ox: 256, oy: 448, s, lw: 5, W: 512, H: 512 };
  const f = fig('i', { x: 0, y: 0, hold: true, cheer: 1, c: 6, name: '', sx: 1, sy: 1 });
  drawFigure(cx, v, f, T);
  drawBomb(cx, v, { x: 0, y: 0, z: 2.4, scale: 1.15, flash: 0, fuse: 0.55, fall: -1 }, T);
}

function drawBadge(cx, b) {
  cx.fillStyle = 'rgba(0,0,0,0)';
  cx.clearRect(0, 0, 256, 256);
  cx.beginPath();
  cx.arc(128, 132, 118, 0, Math.PI * 2);
  cx.fillStyle = 'rgba(20,20,40,0.28)';
  cx.fill();
  cx.beginPath();
  cx.arc(128, 128, 118, 0, Math.PI * 2);
  cx.fillStyle = b.color;
  cx.fill();
  cx.strokeStyle = INK;
  cx.lineWidth = 9;
  cx.stroke();
  cx.beginPath();
  cx.arc(128, 128, 98, 0, Math.PI * 2);
  cx.fillStyle = shade(b.color, 0.28);
  cx.fill();
  cx.strokeStyle = 'rgba(255,255,255,0.55)';
  cx.lineWidth = 5;
  cx.stroke();
  if (b.symbol === 'crown') iconCrown(cx, 128, 132, 62);
  else if (b.symbol === 'flame') iconFlame(cx, 128, 132, 72);
  else if (b.symbol === 'stopwatch') iconStopwatch(cx, 128, 132, 66);
  else iconBombSmall(cx, 128, 136, 70);
}

