// The store art is drawn by the game itself: every poster draws without an error, at its size, with no SDK around.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, fakeCanvas, drawStats } from './harness.mjs';

installGlobals();
const { runPoster } = await import('../game/poster.js');

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512], 'badge-first-win': [256, 256], 'badge-hot-hands': [256, 256], 'badge-close-call': [256, 256], 'badge-bomb-squad': [256, 256] };

for (const [name, [w, h]] of Object.entries(SIZES)) {
  test(`poster=${name} draws at ${w}x${h} and says it is ready`, async () => {
    delete document.body.dataset.ready;
    delete document.body.dataset.error;
    const canvas = fakeCanvas();
    drawStats.text.length = 0;
    await runPoster(name, canvas);
    assert.equal(canvas.width, w);
    assert.equal(canvas.height, h);
    assert.equal(document.body.dataset.ready, '1');
    assert.equal(window.onceworlds, undefined, 'poster mode never needs the SDK');
    if (name === 'cover') assert.deepEqual(drawStats.text, ['PASS THE ', 'PASS THE ', 'BOMB', 'BOMB'], 'the title is the only text (each part drawn as outline and fill)');
    if (name === 'action' || name === 'icon' || name.startsWith('badge-')) assert.deepEqual(drawStats.text, [], 'no text at all');
    if (name === 'win') {
      const words = drawStats.text.filter((t) => t.trim());
      assert.ok(words.length >= 6 && words.every((t) => /^[123]$/.test(t)), `only the place numbers, got ${words.join(',')}`);
    }
  });
}
