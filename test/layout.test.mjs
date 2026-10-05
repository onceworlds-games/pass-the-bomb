// Layout checks without eyes: at several window sizes, play a whole match and record where every piece of text is drawn.
// The platform keeps the top-left 130x56 px and (in the lobby) the bottom ~90 px, so nothing may sit there, and everything
// has to fit inside the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, frame, frames, clock, fakeCanvas, Server, fakeOw, drawStats, resetWorld } from './harness.mjs';

installGlobals();
const { startGame } = await import('../game/game.js');

const NAMES = new Set(['Alice', 'Pip', 'Ziggy', 'Bubbles', 'Noodle', 'Pickles', 'Mochi', 'Sprout', 'Bean', 'Waffles', 'Taco', 'Biscuit', 'Peanut', 'Jelly', 'Nugget', 'You']);
const SIZES = [
  [844, 390, 'phone landscape'],
  [568, 320, 'small phone landscape'],
  [1280, 720, 'laptop'],
  [390, 844, 'phone portrait'],
  [1024, 768, 'tablet'],
];

function inside(b, W, H, slack = 3) {
  return b.x0 >= -slack && b.y0 >= -slack && b.x1 <= W + slack && b.y1 <= H + slack;
}

for (const [W, H, label] of SIZES) {
  test(`${label} ${W}x${H}: text fits, and keeps clear of the platform's corners`, () => {
    resetWorld();
    globalThis.innerWidth = W;
    globalThis.innerHeight = H;
    const server = new Server({ latency: 0 });
    server.settings.rounds = 3;
    const room = server.join('p1', 'Alice');
    const ow = fakeOw(room);
    const canvas = fakeCanvas();
    globalThis.__page = 5;
    startGame({ ow, room, standalone: false, canvas });
    globalThis.__page = 0;
    const scenes = {};
    const grab = (name, n, settle = 14) => {
      frames(settle); // let the pop-in animations settle
      drawStats.boxes.length = 0;
      drawStats.record = true;
      frames(n);
      drawStats.record = false;
      (scenes[name] ??= []).push(...drawStats.boxes.map((b) => ({ ...b })));
    };
    grab('title', 30);
    globalThis.__dispatch('keydown', { key: ' ', code: 'Space' }, 5);
    grab('lobby', 90);
    room.startMatch();
    grab('countdown', 60 * 2.2);
    grab('go', 20);
    grab('banner', 60);
    let got = new Set();
    for (let n = 0; n < 60 * 500 && !got.has('final'); n++) {
      frame();
      const g = room.state.g;
      if (g && room.match.phase === 'playing') {
        if ((g.phase === 'over' || g.phase === 'between' || g.phase === 'final') && !got.has(g.phase + g.n)) {
          got.add(g.phase + g.n);
          if (g.phase === 'final') got.add('final');
          grab(g.phase, 60 * (g.phase === 'final' ? 4 : 1.5), g.phase === 'final' ? 140 : g.phase === 'over' ? 24 : 40);
        }
      }
    }
    assert.ok(got.has('final'));
    grab('results', 60);
    for (const [name, boxes] of Object.entries(scenes)) {
      assert.ok(boxes.length > 0, `${name}: nothing was drawn`);
      for (const b of boxes) {
        const where = `${name}: "${b.s}" at ${Math.round(b.x0)},${Math.round(b.y0)}-${Math.round(b.x1)},${Math.round(b.y1)}`;
        if (/^\+\d$|^Zz$/.test(b.s)) continue; // floating numbers drift wherever the action is
        if (name !== 'final' || !['1', '2', '3'].includes(b.s)) assert.ok(inside(b, W, H, name === 'between' ? 26 : 3), `${where} leaves the window`);
        assert.ok(!(b.x0 < 130 && b.y0 < 56), `${where} is in the platform's top-left corner`);
        if (['lobby', 'countdown'].includes(name) && !/^[123]$/.test(b.s) && !NAMES.has(b.s)) assert.ok(b.y1 <= H - 88, `${where} sits in the lobby strip's space`);
      }
    }
    // the biggest things really are big: the countdown digit and the title
    const digit = scenes.countdown.filter((b) => /^[123]$/.test(b.s)).sort((a, b) => b.y1 - b.y0 - (a.y1 - a.y0))[0];
    assert.ok(digit && digit.y1 - digit.y0 >= Math.min(W, H) * 0.3, 'the countdown digit is huge');
    // no text smaller than 11 px anywhere that matters
    for (const [name, boxes] of Object.entries(scenes)) {
      if (['countdown', 'go', 'banner'].includes(name)) continue; // these scale up from nothing
      for (const b of boxes) assert.ok(b.h >= 10.5, `${name}: "${b.s}" is only ${b.h.toFixed(1)} px tall`);
    }
  });
}
