import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raySegment, rayCircle, rayBox, reflect, snapDeg, normDeg, deltaDeg, pointSegment, finite, clampf, segmentsCross } from '../game/sim/geom.js';

test('a ray hits a segment in front of it and misses one behind', () => {
  const hit = raySegment(0, 0, 1, 0, 5, -1, 5, 1);
  assert.ok(hit);
  assert.equal(Math.round(hit.t * 1000) / 1000, 5);
  assert.equal(hit.u, 0.5);
  assert.equal(raySegment(0, 0, -1, 0, 5, -1, 5, 1), null);
});

test('parallel and collinear rays never hit; an endpoint (vertex) counts as a hit', () => {
  assert.equal(raySegment(0, 0, 1, 0, 2, 0, 8, 0), null);
  assert.equal(raySegment(0, 1, 1, 0, 2, 0, 8, 0), null);
  const vertex = raySegment(0, 0, 1, 0, 5, 0, 5, 3);
  assert.ok(vertex && vertex.u === 0);
  const vertex2 = raySegment(0, 3, 1, 0, 5, 0, 5, 3);
  assert.ok(vertex2 && vertex2.u === 1);
});

test('ray-circle gives the entry from outside and the exit from inside', () => {
  const a = rayCircle(0, 0, 1, 0, 10, 0, 2);
  assert.ok(a && !a.inside && Math.abs(a.t - 8) < 1e-9);
  const b = rayCircle(10, 0, 1, 0, 10, 0, 2);
  assert.ok(b && b.inside && Math.abs(b.t - 2) < 1e-9);
  assert.equal(rayCircle(0, 5, 1, 0, 10, 0, 2), null);
  assert.equal(rayCircle(20, 0, 1, 0, 10, 0, 2), null);
});

test('ray-box finds the entry face', () => {
  const h = rayBox(0, 5, 1, 0, 10, 0, 20, 10);
  assert.ok(h && h.t === 10 && h.nx === -1 && h.ny === 0);
  assert.equal(rayBox(0, 50, 1, 0, 10, 0, 20, 10), null);
});

test('reflection across a vertical plate turns east into west; across 45 degrees turns east into south', () => {
  const r1 = reflect(1, 0, 1, 0);
  assert.ok(Math.abs(r1.x + 1) < 1e-9 && Math.abs(r1.y) < 1e-9);
  const n = { x: -Math.sin(Math.PI / 4), y: Math.cos(Math.PI / 4) };
  const r2 = reflect(1, 0, n.x, n.y);
  assert.ok(Math.abs(r2.x) < 1e-9 && Math.abs(r2.y - 1) < 1e-9);
});

test('angles snap, normalise and difference the short way round', () => {
  assert.equal(snapDeg(37), 30);
  assert.equal(snapDeg(38), 45);
  assert.equal(snapDeg(-7, 5), 355);
  assert.equal(normDeg(725), 5);
  assert.equal(deltaDeg(350, 10), 20);
  assert.equal(deltaDeg(10, 350), -20);
  assert.equal(snapDeg(NaN), 0);
  assert.equal(normDeg(Infinity), 0);
});

test('point-segment distance and NaN-safe numbers', () => {
  const q = pointSegment(5, 3, 0, 0, 10, 0);
  assert.equal(q.d, 3);
  assert.equal(q.u, 0.5);
  assert.equal(finite(NaN, 7), 7);
  assert.equal(finite('3', 7), 7);
  assert.equal(clampf(Infinity, 0, 10, 5), 5);
  assert.equal(clampf(1e9, 0, 10, 5), 10);
  assert.equal(clampf(undefined, 0, 10, 5), 5);
  assert.ok(segmentsCross(0, 0, 10, 10, 0, 10, 10, 0));
  assert.equal(segmentsCross(0, 0, 10, 0, 0, 1, 10, 1), null);
});
