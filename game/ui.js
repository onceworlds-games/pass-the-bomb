// Screens drawn on the canvas: title, lobby settings, countdown, banners, HUD, scoreboard, podium. Labels of one to three
// words, numbers huge, icons over words. Nothing here keeps state: every function draws what it is given.

import { clamp, MAP_IDS, ROUND_OPTIONS } from './rules.js';
import { MAPS } from './maps.js';
import { INK, FONT, text, fitSize, rr, easeOutBack, easeOutCubic, iconStar, iconPerson, iconSkull, iconCrown, iconFlame, iconBombSmall, drawBomb, drawHead, drawFigure } from './draw.js';

const TAU = Math.PI * 2;
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
export const ordinal = (i) => ORDINAL[i] ?? `${i + 1}th`;

function pill(ctx, x, y, w, h, fill, stroke = true) {
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- title

export function drawLogo(ctx, v, cx, cy, size, t) {
  const bump = 1 + Math.sin(t * 2.4) * 0.012;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.045);
  ctx.scale(bump, bump);
  text(ctx, 'PASS THE', 0, -size * 0.78, size, { fill: '#ffffff', width: size * 0.2 });
  const big = size * 1.75;
  ctx.font = `${big}px ${FONT}`;
  const w = ctx.measureText('BOMB').width;
  text(ctx, 'BOMB', -size * 0.55, size * 0.5, big, { fill: '#ff5a2a', width: big * 0.14 });
  // the bomb, with its fuse burning
  const u = big * 0.95;
  const bx = -size * 0.55 + w / 2 + big * 0.5;
  const by = size * 0.3;
  drawBomb(ctx, { ox: 0, oy: 0, s: u, lw: Math.max(3, big * 0.06) }, { x: bx / u, y: by / u, z: 0, scale: 1, flash: 0, fuse: 0.8, fall: -1 }, t);
  ctx.restore();
}

/** Title: the logo and one big PLAY button. Returns the button's rectangle. */
export function drawTitle(ctx, v, t, touch) {
  ctx.fillStyle = 'rgba(20,12,48,0.34)';
  ctx.fillRect(0, 0, v.W, v.H);
  const size = clamp(Math.min(v.W * 0.075, v.H * 0.12), 26, 84);
  drawLogo(ctx, v, v.W / 2, v.H * 0.34, size, t);
  const bw = clamp(v.W * 0.3, 190, 340);
  const bh = clamp(v.H * 0.18, 64, 112);
  const bx = (v.W - bw) / 2;
  const by = v.H * 0.66;
  const k = 1 + Math.sin(t * 4.5) * 0.035;
  ctx.save();
  ctx.translate(bx + bw / 2, by + bh / 2);
  ctx.scale(k, k);
  rr(ctx, -bw / 2, -bh / 2 + bh * 0.1, bw, bh, bh * 0.3);
  ctx.fillStyle = 'rgba(20,20,40,0.35)';
  ctx.fill();
  rr(ctx, -bw / 2, -bh / 2, bw, bh, bh * 0.3);
  ctx.fillStyle = '#2fd05a';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(4, bh * 0.07);
  ctx.stroke();
  rr(ctx, -bw / 2 + bh * 0.12, -bh / 2 + bh * 0.1, bw - bh * 0.24, bh * 0.28, bh * 0.14);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();
  // a play triangle and the word
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(3, bh * 0.05);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-bw * 0.3, -bh * 0.24);
  ctx.lineTo(-bw * 0.3, bh * 0.24);
  ctx.lineTo(-bw * 0.17, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  text(ctx, 'PLAY', bw * 0.06, 0, bh * 0.52);
  ctx.restore();
  if (!touch) {
    const ks = clamp(bh * 0.2, 12, 18);
    text(ctx, 'Space', bx + bw / 2, by + bh + ks * 1.4, ks, { fill: '#ffffff', width: ks * 0.28 });
  }
  return { x: bx, y: by, w: bw, h: bh };
}

// ---------------------------------------------------------------- lobby

const hits = [];

/**
 * The game's settings as big values at the top. The host's chips can be tapped; everyone else sees only the chosen values.
 * Returns the tappable rectangles: [{ x, y, w, h, id, value }].
 */
export function drawLobbyTop(ctx, v, s) {
  hits.length = 0;
  const chipH = Math.max(44, Math.min(54, v.H * 0.1));
  const gap = 8;
  const rounds = s.canEdit ? ROUND_OPTIONS : [s.rounds];
  const maps = s.canEdit ? MAP_IDS : [s.map];
  // Find the biggest text that lets the rows fit: the first row keeps clear of the platform's buttons at the top left.
  let fs = clamp(chipH * 0.42, 15, 24);
  let L;
  for (;;) {
    L = lobbyLayout(ctx, v, fs, rounds, maps, gap);
    if (L.fits || fs <= 13) break;
    fs -= 1;
  }
  let y = 8;
  for (const row of L.rows) {
    let x = row.x;
    for (const g of row.groups) {
      if (g === 0) {
        text(ctx, 'Rounds', x, y + chipH / 2, fs, { align: 'left', width: fs * 0.24 });
        x += L.labelW + 14;
        for (const r of rounds) {
          chip(ctx, x, y, L.chipW, chipH, String(r), r === s.rounds, fs, null);
          if (s.canEdit) hits.push({ x, y, w: L.chipW, h: chipH, id: 'rounds', value: r });
          x += L.chipW + gap;
        }
      } else {
        maps.forEach((m, i) => {
          const w = L.mapWs[i];
          chip(ctx, x, y, w, chipH, MAPS[m].name, m === s.map, fs, MAPS[m].pal.ground);
          if (s.canEdit) hits.push({ x, y, w, h: chipH, id: 'map', value: m });
          x += w + gap;
        });
      }
      x += 10;
    }
    y += chipH + 6;
  }
  return hits;
}

function lobbyLayout(ctx, v, fs, rounds, maps, gap) {
  ctx.font = `${fs}px ${FONT}`;
  const labelW = ctx.measureText('Rounds').width;
  const chipW = Math.max(44, fs * 1.9);
  const roundsW = labelW + 14 + rounds.length * (chipW + gap);
  const mapWs = maps.map((m) => ctx.measureText(MAPS[m].name).width + fs * 2.4 + 12);
  const mapsW = mapWs.reduce((a, b) => a + b + gap, 0);
  const left = 140; // the platform's buttons sit in the top-left corner
  const place = (w, minX) => clamp((v.W - w) / 2, minX, Math.max(minX, v.W - 8 - w));
  const both = roundsW + 18 + mapsW;
  if (both <= v.W - 8 - left) return { fits: true, labelW, chipW, mapWs, rows: [{ x: place(both, left), groups: [0, 1] }] };
  // two rows: the first still keeps clear of the corner, the second may use the whole width
  const fits = roundsW <= v.W - 8 - left && mapsW - gap <= v.W - 16;
  return { fits, labelW, chipW, mapWs, rows: [{ x: place(roundsW, left), groups: [0] }, { x: place(mapsW, 8), groups: [1] }] };
}

function chip(ctx, x, y, w, h, label, on, fs, dot) {
  rr(ctx, x, y + 3, w, h, h * 0.3);
  ctx.fillStyle = 'rgba(20,20,40,0.3)';
  ctx.fill();
  rr(ctx, x, y, w, h, h * 0.3);
  ctx.fillStyle = on ? '#ffd21f' : 'rgba(255,255,255,0.88)';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = on ? 4 : 2.5;
  ctx.stroke();
  let tx = x + w / 2;
  if (dot) {
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(x + h * 0.38, y + h / 2, h * 0.2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    tx = x + h * 0.62 + (w - h * 0.62) / 2;
  }
  text(ctx, label, tx, y + h / 2 + 1, fs, { fill: on ? '#ffffff' : '#4a4468', width: on ? fs * 0.24 : 0 });
}

/** A short hint just above the platform's ready strip. */
export function drawHint(ctx, v, str, t) {
  const fs = clamp(v.H * 0.052, 16, 28);
  ctx.font = `${fs}px ${FONT}`;
  const w = ctx.measureText(str).width + fs * 1.6;
  const h = fs * 1.7;
  const x = (v.W - w) / 2;
  const y = v.H - 96 - h + Math.sin(t * 3) * 2;
  pill(ctx, x, y, w, h, 'rgba(27,21,48,0.72)');
  text(ctx, str, v.W / 2, y + h / 2 + 1, fs, { width: fs * 0.2 });
}

const COUNT_COLORS = { 3: '#ff4b4b', 2: '#ff8a1f', 1: '#ffd21f', GO: '#2fd05a' };

/** The big 3, 2, 1, GO!. `k` is how far into this number we are (0..1). */
export function drawCountdown(ctx, v, label, k) {
  const base = Math.min(v.W, v.H) * 0.42;
  const pop = label === 'GO' ? 0.8 : 1;
  const sc = 1 + (1 - easeOutCubic(clamp(k * 3, 0, 1))) * 0.45;
  ctx.save();
  ctx.globalAlpha = k > 0.8 ? clamp((1 - k) * 5, 0, 1) : 1;
  ctx.translate(v.W / 2, v.H * 0.46);
  ctx.scale(sc, sc);
  const str = label === 'GO' ? 'GO!' : String(label);
  const size = fitSize(ctx, str, base * pop, v.W * 0.8);
  text(ctx, str, 0, 0, size, { fill: COUNT_COLORS[label] ?? '#ffffff', width: size * 0.16 });
  ctx.restore();
}

// ---------------------------------------------------------------- in play

/** A goal in two to four words, popping in and out. `age` ms since the round began. */
export function drawBanner(ctx, v, main, sub, age, dur) {
  if (age < 0 || age > dur) return;
  const inK = clamp(age / 260, 0, 1);
  const outK = clamp((dur - age) / 260, 0, 1);
  const sc = easeOutBack(inK);
  const size = fitSize(ctx, main, clamp(v.H * 0.15, 34, 110), v.W * 0.86);
  ctx.save();
  ctx.globalAlpha = outK;
  ctx.translate(v.W / 2, v.H * 0.3);
  ctx.scale(Math.max(0.01, sc), Math.max(0.01, sc));
  if (sub) text(ctx, sub, 0, -size * 0.85, size * 0.42, { fill: '#ffe066' });
  text(ctx, main, 0, 0, size, { fill: '#ffffff', width: size * 0.2 });
  ctx.restore();
}

/** Top centre: the round, who is left; top right: your score. */
export function drawHud(ctx, v, h) {
  const fs = clamp(v.top * 0.5, 15, 26);
  const cy = v.top * 0.5 + 1 + (h.dy || 0); // watchers: lower, under the platform's "Watching" note
  const ph = fs * 1.75;
  ctx.font = `${fs}px ${FONT}`;
  const compact = v.W < 560;
  const label = compact ? `${h.round}/${h.rounds}` : `ROUND ${h.round}/${h.rounds}`;
  const lw = ctx.measureText(label).width;
  const nw = ctx.measureText(String(h.alive)).width;
  const w = lw + nw + fs * 3.6;
  const x = Math.max(136, (v.W - w) / 2); // never over the platform's buttons
  pill(ctx, x, cy - ph / 2, w, ph, 'rgba(27,21,48,0.7)');
  text(ctx, label, x + fs * 0.9, cy + 1, fs, { align: 'left', width: fs * 0.2 });
  iconPerson(ctx, x + fs * 0.9 + lw + fs * 0.95, cy, fs * 0.62);
  text(ctx, String(h.alive), x + w - fs * 0.8, cy + 1, fs, { align: 'right', width: fs * 0.2 });
  // your score
  const sc = String(h.score);
  const sw = ctx.measureText(sc).width;
  const w2 = sw + fs * (h.out ? 4.2 : 2.6);
  const x2 = v.W - 10 - w2;
  pill(ctx, x2, cy - ph / 2, w2, ph, 'rgba(27,21,48,0.7)');
  let ix = x2 + fs * 0.95;
  if (h.out) {
    iconSkull(ctx, ix, cy, fs * 0.6);
    ix += fs * 1.5;
  }
  iconStar(ctx, ix, cy, fs * 0.6);
  text(ctx, sc, x2 + w2 - fs * 0.7, cy + 1, fs, { align: 'right', width: fs * 0.2 });
}

/** A small line under the HUD ("Tag someone!"). */
export function drawPrompt(ctx, v, str, a, t) {
  const fs = clamp(v.H * 0.06, 16, 30);
  ctx.save();
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.font = `${fs}px ${FONT}`;
  const w = ctx.measureText(str).width + fs * 1.6;
  const h = fs * 1.7;
  const x = (v.W - w) / 2;
  const y = v.top + 8 + Math.sin(t * 6) * 2;
  pill(ctx, x, y, w, h, '#ff3b3b');
  text(ctx, str, v.W / 2, y + h / 2 + 1, fs, { width: fs * 0.2 });
  ctx.restore();
}

export function drawWatching(ctx, v, t) {
  const fs = clamp(v.H * 0.045, 14, 24);
  ctx.font = `${fs}px ${FONT}`;
  const w = ctx.measureText('Watching').width + fs * 3;
  const h = fs * 1.9;
  const x = (v.W - w) / 2;
  const y = v.H - h - 12;
  pill(ctx, x, y, w, h, 'rgba(27,21,48,0.72)');
  // an eye
  const ex = x + fs * 1.1;
  const ey = y + h / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(ex, ey, fs * 0.6, fs * 0.38, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(ex + Math.sin(t * 1.3) * fs * 0.15, ey, fs * 0.22, 0, TAU);
  ctx.fill();
  text(ctx, 'Watching', x + fs * 1.9 + (w - fs * 1.9) / 2 - fs * 0.5, y + h / 2 + 1, fs, { width: fs * 0.2 });
}

/** The winner of a round, between the last boom and the scoreboard. */
export function drawWinner(ctx, v, label, f, age) {
  const k = clamp(age / 300, 0, 1);
  const size = fitSize(ctx, label, clamp(v.H * 0.13, 30, 96), v.W * 0.86);
  ctx.save();
  ctx.translate(v.W / 2, Math.max(v.H * 0.24, 80));
  const sc = Math.max(0.01, easeOutBack(k));
  ctx.scale(sc, sc);
  iconCrown(ctx, 0, -size * 0.95, size * 0.42);
  text(ctx, label, 0, 0, size, { fill: '#ffd21f', width: size * 0.2 });
  ctx.restore();
}

// ---------------------------------------------------------------- between rounds

/**
 * rows: [{ f: figure, name, total, add, me }] sorted best first. `t` seconds since the scoreboard opened.
 */
export function drawScoreboard(ctx, v, rows, t, round, rounds) {
  const n = rows.length;
  ctx.fillStyle = 'rgba(20,12,48,0.55)';
  ctx.fillRect(0, 0, v.W, v.H);
  const cols = n > 6 && v.W >= 520 ? 2 : 1;
  const per = Math.ceil(n / cols);
  const head = clamp(v.H * 0.1, 30, 56);
  const rh = clamp((v.H - head - 110) / per, 28, 62);
  const colW = Math.min(cols === 2 ? (v.W - 40) / 2 : v.W - 24, 420);
  const totalW = colW * cols + (cols - 1) * 16;
  const x0 = (v.W - totalW) / 2;
  const y0 = Math.max(60, (v.H - (head + rh * per)) / 2 - 20); // below the platform's buttons
  text(ctx, `ROUND ${round}`, v.W / 2, y0 + head * 0.5, head * 0.8, { fill: '#ffe066' });
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const col = cols === 2 && i >= per ? 1 : 0;
    const j = i - col * per;
    const x = x0 + col * (colW + 16);
    const y = y0 + head + j * rh;
    const ti = 0.1 + i * 0.05;
    const slide = easeOutCubic(clamp((t - ti) / 0.3, 0, 1));
    if (slide <= 0) continue;
    ctx.save();
    ctx.globalAlpha = slide;
    ctx.translate((1 - slide) * -24, 0);
    pill(ctx, x, y + 2, colW, rh - 4, r.me ? 'rgba(255,224,102,0.9)' : 'rgba(255,255,255,0.88)');
    const cy = y + rh / 2;
    text(ctx, String(i + 1), x + rh * 0.55, cy + 1, rh * 0.5, { fill: r.me ? '#1b1530' : '#4a4468', width: 0 });
    drawHead(ctx, x + rh * 1.3, cy + rh * 0.05, rh * 0.31, r.f, 2.5, t);
    const nameW = colW - rh * 4 - 4;
    const ns = fitSize(ctx, r.name, rh * 0.5, Math.max(40, nameW));
    text(ctx, r.name, x + rh * 1.9, cy + 1, ns, { align: 'left', fill: '#1b1530', width: 0 });
    // the points fly in from the left of the score
    const ta = 0.7 + i * 0.05;
    const fly = clamp((t - ta) / 0.5, 0, 1);
    const shown = fly >= 1 ? r.total : r.total - r.add;
    const sx = x + colW - rh * 0.5;
    iconStar(ctx, sx - rh * 1.35, cy, rh * 0.26);
    const since = t - (ta + 0.5);
    const pop = since > 0 && since < 0.3 ? 1 + 0.25 * Math.sin((since / 0.3) * Math.PI) : 1;
    text(ctx, String(shown), sx, cy + 1, rh * 0.55 * pop, { align: 'right', fill: '#1b1530', width: 0 });
    ctx.restore();
    if (fly > 0 && fly < 1 && r.add > 0) {
      const e = easeOutCubic(fly);
      ctx.globalAlpha = 1 - fly * 0.5;
      text(ctx, `+${r.add}`, x + colW * 0.55 + (sx - rh * 1.3 - (x + colW * 0.55)) * e, cy - (1 - e) * rh * 0.7, rh * 0.5, { fill: '#2fd05a' });
      ctx.globalAlpha = 1;
    }
  }
}

/** The room closed: one message and one button. Returns the button's rectangle. */
export function drawClosed(ctx, v, reason, t) {
  ctx.fillStyle = 'rgba(20,12,48,0.7)';
  ctx.fillRect(0, 0, v.W, v.H);
  const msg = reason === 'kicked' ? 'You were removed' : reason === 'replaced' ? 'Playing in another tab' : 'Disconnected';
  const label = reason === 'replaced' ? 'Play here' : reason === 'kicked' ? 'Play' : 'Rejoin';
  const size = fitSize(ctx, msg, clamp(v.H * 0.12, 26, 70), v.W * 0.86);
  text(ctx, msg, v.W / 2, v.H * 0.36, size);
  const bw = clamp(v.W * 0.28, 170, 300);
  const bh = clamp(v.H * 0.16, 56, 90);
  const bx = (v.W - bw) / 2;
  const by = v.H * 0.52;
  const k = 1 + Math.sin(t * 4.5) * 0.03;
  ctx.save();
  ctx.translate(bx + bw / 2, by + bh / 2);
  ctx.scale(k, k);
  rr(ctx, -bw / 2, -bh / 2, bw, bh, bh * 0.3);
  ctx.fillStyle = '#2fd05a';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.stroke();
  text(ctx, label, 0, 1, bh * 0.5);
  ctx.restore();
  return { x: bx, y: by, w: bw, h: bh };
}

// ---------------------------------------------------------------- the end

const MEDAL = ['#ffd21f', '#d5dde8', '#e8944a'];
const tmpFig = [{}, {}, {}];

/**
 * p: { top: [{ f, name, score }] (1st, 2nd, 3rd), place: your place index or -1, awards: { potato, slippery } (each { f, name, n }), t: seconds }
 * Figures are drawn standing on the blocks (their own x, y are ignored).
 */
export function drawPodium(ctx, v, p, t) {
  ctx.fillStyle = 'rgba(30,14,70,0.62)';
  ctx.fillRect(0, 0, v.W, v.H);
  const bw = clamp(v.W * 0.17, 92, 210);
  const floor = v.H * 0.8;
  const heights = [v.H * 0.3, v.H * 0.215, v.H * 0.155];
  const xs = [v.W / 2, v.W / 2 - bw * 1.12, v.W / 2 + bw * 1.12];
  const starts = [1.0, 0.6, 0.2];
  for (let i = 2; i >= 0; i--) {
    const e = p.top[i];
    if (!e) continue;
    const k = easeOutBack(clamp((t - starts[i]) / 0.55, 0, 1));
    if (k <= 0.001) continue;
    const bh = heights[i] * Math.min(1, k);
    const x = xs[i];
    const top = floor - bh;
    rr(ctx, x - bw / 2, top, bw, bh, 8);
    ctx.fillStyle = MEDAL[i];
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.stroke();
    rr(ctx, x - bw / 2 + 6, top + 6, bw - 12, Math.max(0, bh * 0.16), 6);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
    text(ctx, String(i + 1), x, top + bh * 0.36, Math.min(bh * 0.46, bw * 0.5), { fill: '#ffffff' });
    if (bh > 40 && e.score !== '') {
      const ss = clamp(bh * 0.22, 14, 28);
      iconStar(ctx, x - bw * 0.2, top + bh * 0.79, ss * 0.5);
      text(ctx, String(e.score), x + bw * 0.04, top + bh * 0.79 + 1, ss, { fill: '#1b1530', width: 0 });
    }
    // the figure
    if (t > starts[i] + 0.25) {
      const fs = bw * 0.46;
      const pv = { ox: x, oy: top, s: fs, lw: clamp(fs * 0.14, 2.5, 5), W: v.W, H: v.H };
      const f = Object.assign(tmpFig[i], e.f, { x: 0, y: 0, z: 0, rot: 0, alpha: 1, sx: 1, sy: 1, popT: 1, hold: false, heat: 0, soot: 0, ghost: false, stun: false, imm: false, dash: false, me: false, ready: false, you: false, fly: -1, vx: 0, vy: 0, cheer: i === 0 ? 1 : 0 });
      const hop = Math.abs(Math.sin(t * 5 + i)) * (i === 0 ? 0.28 : 0.05);
      f.z = hop;
      drawFigure(ctx, pv, f, t);
      const nx = x;
      const ny = top - 1.95 * fs - hop * fs;
      if (i === 0) iconCrown(ctx, nx, ny - fs * 0.05, fs * 0.36);
      text(ctx, e.name, nx, ny - (i === 0 ? fs * 0.55 : fs * 0.25), clamp(fs * 0.42, 13, 24), { fill: '#ffffff' });
    }
  }
  const baseY = floor + clamp(v.H * 0.05, 18, 34);
  if (p.place > 2 && t > 1.2) {
    const fs = clamp(v.H * 0.06, 16, 30);
    const s = `You: ${ordinal(p.place)}`;
    ctx.font = `${fs}px ${FONT}`;
    const w = ctx.measureText(s).width + fs * 1.6;
    pill(ctx, (v.W - w) / 2, baseY - fs * 0.85, w, fs * 1.7, '#ffe066');
    text(ctx, s, v.W / 2, baseY + 1, fs, { fill: '#1b1530', width: 0 });
  }
  // fun awards
  if (t > 1.8) {
    const items = [];
    if (p.awards.potato) items.push({ icon: 'flame', label: 'Hot Potato', name: p.awards.potato.name, extra: String(p.awards.potato.n) });
    if (p.awards.slippery) items.push({ icon: 'bomb', label: 'Slippery', name: p.awards.slippery.name, extra: '' });
    let fs = clamp(v.H * 0.04, 12, 20);
    const str = (it) => `${it.label}  ${it.name}${it.extra ? '  ' + it.extra : ''}`;
    const widths = () => items.map((it) => ctx.measureText(str(it)).width + fs * 3);
    let ws;
    for (;;) {
      ctx.font = `${fs}px ${FONT}`;
      ws = widths();
      if (Math.max(0, ...ws) <= v.W - 16 || fs <= 11) break;
      fs -= 1;
    }
    const total = ws.reduce((a, b) => a + b + 12, -12);
    const stack = total > v.W - 16; // two chips that don't fit side by side go one above the other
    const rowH = fs * 2 + 6;
    let y = Math.min(v.H - (stack ? rowH * items.length : rowH) - 4, baseY + clamp(v.H * 0.06, 20, 40));
    let x = (v.W - total) / 2;
    items.forEach((it, i) => {
      if (stack) {
        x = (v.W - ws[i]) / 2;
        y = Math.min(v.H - rowH * (items.length - i) - 4, y);
      }
      const a = easeOutCubic(clamp((t - 1.8 - i * 0.25) / 0.3, 0, 1));
      ctx.globalAlpha = a;
      pill(ctx, x, y, ws[i], fs * 2, 'rgba(255,255,255,0.92)');
      if (it.icon === 'flame') iconFlame(ctx, x + fs * 1.1, y + fs, fs * 0.7);
      else iconBombSmall(ctx, x + fs * 1.1, y + fs, fs * 0.65);
      text(ctx, str(it), x + fs * 2.1, y + fs + 1, fs, { align: 'left', fill: '#1b1530', width: 0 });
      ctx.globalAlpha = 1;
      if (stack) y += rowH;
      else x += ws[i] + 12;
    });
  }
}

/** The results, kept on screen for a few seconds over the lobby after the match. `a` fades it out (0..1). */
export function drawResultsCard(ctx, v, p, a) {
  const cw = Math.min(v.W - 24, 440);
  const ch = clamp(v.H * 0.3, 96, 150);
  const x = (v.W - cw) / 2;
  const y = clamp(v.H * 0.3, 70, v.H - ch - 110);
  ctx.save();
  ctx.globalAlpha = clamp(a, 0, 1);
  pill(ctx, x, y, cw, ch, 'rgba(27,21,48,0.82)');
  const n = Math.min(3, p.top.length);
  const slot = cw / 3;
  for (let i = 0; i < n; i++) {
    const e = p.top[i];
    const cx = x + slot * (i + 0.5);
    const r = ch * 0.17;
    if (i === 0) iconCrown(ctx, cx, y + ch * 0.2, r * 0.8);
    drawHead(ctx, cx, y + ch * 0.45, r, e.f, 2.5, 0);
    text(ctx, e.name, cx, y + ch * 0.72, fitSize(ctx, e.name, ch * 0.14, slot - 12), { width: 3 });
    iconStar(ctx, cx - ch * 0.1, y + ch * 0.9, ch * 0.07);
    text(ctx, String(e.score), cx + ch * 0.03, y + ch * 0.9, ch * 0.14, { align: 'left', width: 3 });
    text(ctx, String(i + 1), cx - r - 6, y + ch * 0.45, ch * 0.2, { fill: MEDAL[i], width: 4 });
  }
  if (p.place > 2) {
    const fs = clamp(ch * 0.15, 13, 22);
    text(ctx, `You: ${ordinal(p.place)}`, x + cw / 2, y + ch + fs * 1.2, fs, { fill: '#ffe066' });
  }
  ctx.restore();
}

