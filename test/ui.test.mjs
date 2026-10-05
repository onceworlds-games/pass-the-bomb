// The screens with the most in them, at their fullest (12 players, long names, big scores), at several window sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, fakeCtx, drawStats } from './harness.mjs';

installGlobals();
const ui = await import('../game/ui.js');
const draw = await import('../game/draw.js');

const SIZES = [[844, 390], [568, 320], [1280, 720], [390, 844], [1024, 768], [360, 640]];
const LONG = ['Bubbles the Brave', 'Nugget', 'Mochi', 'WWWWWWWWWWWWWWWW', 'Pip', 'Ziggy', 'Taco', 'Bean', 'Sprout', 'Jelly', 'Biscuit', 'Peanut'];

function rowsOf(n) {
  return Array.from({ length: n }, (_, i) => {
    const f = draw.newFig('r' + i);
    f.c = i % 12;
    f.bot = i % 2 === 0;
    return { f, name: LONG[i % LONG.length].slice(0, 14), total: 99 - i * 3, add: 10 - (i % 8), me: i === 3 };
  });
}

function boxes(fn) {
  drawStats.boxes.length = 0;
  drawStats.record = true;
  fn();
  drawStats.record = false;
  return drawStats.boxes.map((b) => ({ ...b }));
}

function fits(list, W, H, label, { corner = true } = {}) {
  assert.ok(list.length > 0, `${label}: nothing drawn`);
  for (const b of list) {
    const where = `${label}: "${b.s}" at ${Math.round(b.x0)},${Math.round(b.y0)}-${Math.round(b.x1)},${Math.round(b.y1)}`;
    assert.ok(b.x0 >= -2 && b.y0 >= -2 && b.x1 <= W + 2 && b.y1 <= H + 2, `${where} leaves the window`);
    if (corner) assert.ok(!(b.x0 < 130 && b.y0 < 56), `${where} is in the platform's corner`);
    assert.ok(b.h >= 10.5, `${label}: "${b.s}" is ${b.h.toFixed(1)} px tall`);
  }
}

for (const [W, H] of SIZES) {
  const v = draw.makeView(W, H, 1);
  const ctx = fakeCtx();
  test(`${W}x${H}: a 12-player scoreboard fits and reads`, () => {
    for (const t of [0.2, 1, 3]) fits(boxes(() => ui.drawScoreboard(ctx, v, rowsOf(12), t, 3, 5)), W, H, `scoreboard t=${t}`);
    fits(boxes(() => ui.drawScoreboard(ctx, v, rowsOf(2), 2, 1, 1)), W, H, 'scoreboard of two');
  });
  test(`${W}x${H}: the podium with long names and both awards fits`, () => {
    const top = [0, 1, 2].map((i) => ({ f: rowsOf(3)[i].f, name: LONG[i * 3].slice(0, 14), score: 999 }));
    const p = { top, place: 7, awards: { potato: { name: 'WWWWWWWWWWWWWW', n: 99 }, slippery: { name: 'Bubbles the Bra…', n: 0 } } };
    for (const t of [3, 6]) fits(boxes(() => ui.drawPodium(ctx, v, p, t)), W, H, `podium t=${t}`);
    fits(boxes(() => ui.drawResultsCard(ctx, v, p, 1)), W, H, 'results card');
  });
  test(`${W}x${H}: HUD with big numbers, prompts and banners`, () => {
    fits(boxes(() => ui.drawHud(ctx, v, { round: 5, rounds: 5, alive: 12, score: 9999, out: true })), W, H, 'hud');
    fits(boxes(() => ui.drawHud(ctx, v, { round: 1, rounds: 1, alive: 2, score: 0, out: false })), W, H, 'hud small');
    fits(boxes(() => ui.drawPrompt(ctx, v, 'Tag someone!', 1, 1)), W, H, 'prompt');
    fits(boxes(() => ui.drawBanner(ctx, v, "Don't get caught!", 'ROUND 5', 700, 1500)), W, H, 'banner');
    fits(boxes(() => ui.drawWinner(ctx, v, 'WWWWWWWWWWWWWW wins!', null, 900)), W, H, 'winner');
    fits(boxes(() => ui.drawWatching(ctx, v, 1)), W, H, 'watching');
    fits(boxes(() => ui.drawClosed(ctx, v, 'replaced', 1)), W, H, 'closed');
    fits(boxes(() => ui.drawCountdown(ctx, v, 'GO', 0.5)), W, H, 'go', { corner: false });
  });
  test(`${W}x${H}: the title and the lobby's settings`, () => {
    const vt = draw.makeView(W, H, 1);
    fits(boxes(() => ui.drawTitle(ctx, vt, 1, false)), W, H, 'title');
    const lv = draw.makeView(W, H, 1, { bottom: 88 });
    let hits;
    fits(boxes(() => (hits = ui.drawLobbyTop(ctx, lv, { rounds: 3, map: 'beach', canEdit: true }))), W, H, 'lobby host');
    assert.equal(hits.length, 6, 'three rounds options and three maps are tappable');
    for (const h of hits) {
      assert.ok(h.w >= 44 && h.h >= 44, `a tap target of ${h.w}x${h.h}`);
      assert.ok(h.x >= 0 && h.x + h.w <= W && h.y >= 0 && h.y + h.h <= H, 'inside the window');
      assert.ok(!(h.x < 130 && h.y < 56), 'not over the platform buttons');
    }
    for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
      const a = hits[i];
      const b = hits[j];
      assert.ok(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5, 'tap targets never overlap');
    }
    fits(boxes(() => (hits = ui.drawLobbyTop(ctx, lv, { rounds: 5, map: 'playground', canEdit: false }))), W, H, 'lobby guest');
    assert.equal(hits.length, 0);
    fits(boxes(() => ui.drawHint(ctx, lv, 'Tag to pass the bomb!', 1)), W, H, 'hint', { corner: false });
  });
}
