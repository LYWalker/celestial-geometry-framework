import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Trail } from '../canvas-diagram/scene/trail.js';
import { Sphere } from '../canvas-diagram/scene/sphere.js';
import { Anchor } from '../canvas-diagram/scene/anchor.js';
import { frame } from '../canvas-diagram/scene/types.js';
import { makeFakeCtx } from './helpers/fakeCtx.js';

describe('Trail.points (regression: used to return references into the sample cache)', () => {
  test('mutating a returned point does not corrupt the cached sample', () => {
    const target = new Anchor({ id: 'trail-target', name: 'Target', at: { x: 5, y: 5 } });
    const trail = new Trail({ id: 'trail1', name: 'Trail1', target, span: 1, step: 0.25 });
    const f = frame(1);

    const pts1 = trail.points(f);
    assert.ok(pts1.length > 0);
    pts1[0]!.x = 99999;

    const pts2 = trail.points(f);
    assert.notEqual(pts2[0]!.x, 99999);
    assert.equal(pts2[0]!.x, 5);
  });
});

describe('Trail memoisation (regression: draw()+points() used to redo samplesForRender() twice a frame)', () => {
  test('calling points() then draw() in the same frame does not double the target chain\'s resolution count', () => {
    let radiusCalls = 0;
    const deferent = new Sphere({
      id: 'trail-deferent',
      name: 'Deferent',
      radius: () => {
        radiusCalls++;
        return 100;
      },
      angle: 0,
    });
    const trail = new Trail({ id: 'trail2', name: 'Trail2', target: deferent, span: 1, step: 0.1 });
    const f = frame(1);

    radiusCalls = 0;
    const pts = trail.points(f);
    const afterPoints = radiusCalls;
    assert.ok(afterPoints > 0, 'sampling should have actually walked the chain at least once');

    const ctx = makeFakeCtx();
    trail.draw(ctx, f, 1);
    const afterDraw = radiusCalls;

    assert.equal(
      afterDraw,
      afterPoints,
      `draw() after points() in the same frame should not add further resolutions (points=${afterPoints}, draw brought it to ${afterDraw})`,
    );
    assert.ok(pts.length > 1);
  });

  test('the reverse order (draw() then points()) is equally cheap', () => {
    let angleCalls = 0;
    const deferent = new Sphere({
      id: 'trail-deferent-2',
      name: 'Deferent2',
      radius: 50,
      angle: (f) => {
        angleCalls++;
        return f.t * 10;
      },
    });
    const trail = new Trail({ id: 'trail3', name: 'Trail3', target: deferent, span: 1, step: 0.1 });
    const f = frame(2);
    const ctx = makeFakeCtx();

    angleCalls = 0;
    trail.draw(ctx, f, 1);
    const afterDraw = angleCalls;
    assert.ok(afterDraw > 0);

    trail.points(f);
    const afterPoints = angleCalls;
    assert.equal(afterPoints, afterDraw);
  });
});

describe('Trail construction validation', () => {
  test('throws on a non-positive step', () => {
    const target = new Anchor({ id: 'tv1', name: 'TV1' });
    assert.throws(() => new Trail({ id: 'bad-step', name: 'Bad', target, span: 1, step: 0 }), /step/);
  });
  test('throws on a non-positive span', () => {
    const target = new Anchor({ id: 'tv2', name: 'TV2' });
    assert.throws(() => new Trail({ id: 'bad-span', name: 'Bad', target, span: -1, step: 0.1 }), /span/);
  });
});
