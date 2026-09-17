import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rayCircleFar, lerpPoint, lerpScalar, frame, resolvePoint, type PointLike } from '../canvas-diagram/scene/types.js';
import { Anchor } from '../canvas-diagram/scene/anchor.js';
import { polar } from '../canvas-diagram/geometry.js';
import { nearVec, near } from './helpers/near.js';

describe('rayCircleFar', () => {
  test('origin at the circle\'s own centre: the far point is just polar(bearing, r)', () => {
    const p = rayCircleFar({ x: 0, y: 0 }, 30, { x: 0, y: 0 }, 5);
    assert.ok(nearVec(p, { x: 5 * Math.cos((30 * Math.PI) / 180), y: -5 * Math.sin((30 * Math.PI) / 180) }));
  });

  test('off-centre origin: hand-derived intersection', () => {
    // origin (0,0), bearing 0 (due east), circle centred (5,0) radius 10.
    // The ray is the whole positive x-axis; the circle spans x in [-5, 15]
    // along y=0, so the FAR intersection (the one further from origin) is
    // at x=15.
    const p = rayCircleFar({ x: 0, y: 0 }, 0, { x: 5, y: 0 }, 10);
    assert.ok(nearVec(p, { x: 15, y: 0 }));
  });

  test('off-centre origin, off-axis bearing: distance from centre equals radius', () => {
    // Construct a centre that's guaranteed to lie along the ray (50 world
    // units out along bearing 65 from origin), so the ray is guaranteed to
    // actually intersect a radius-12 circle around it — an arbitrary
    // bearing picked independently of the centre can easily miss the
    // circle entirely, at which point rayCircleFar's `disc` clamps to 0
    // and the result is a closest-approach point, not a true intersection,
    // which would make this same assertion meaningless.
    const origin = { x: 2, y: -3 };
    const bearing = 65;
    const offset = polar(bearing, 50);
    const centre = { x: origin.x + offset.x, y: origin.y + offset.y };
    const radius = 12;
    const p = rayCircleFar(origin, bearing, centre, radius);
    const distFromCentre = Math.hypot(p.x - centre.x, p.y - centre.y);
    assert.ok(near(distFromCentre, radius, 1e-6));
    // and it should be the FAR intersection: further from origin than centre is
    const distFromOrigin = Math.hypot(p.x - origin.x, p.y - origin.y);
    assert.ok(distFromOrigin > 50);
  });
});

describe('lerpPoint', () => {
  test('endpoints and midpoint', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 20 };
    const l = lerpPoint(a, b, 0);
    assert.deepEqual(l.position(frame(0)), { x: 0, y: 0 });
    const l1 = lerpPoint(a, b, 1);
    assert.deepEqual(l1.position(frame(0)), { x: 10, y: 20 });
    const lmid = lerpPoint(a, b, 0.5);
    assert.deepEqual(lmid.position(frame(0)), { x: 5, y: 10 });
  });
});

describe('lerpScalar', () => {
  test('endpoints and midpoint', () => {
    const s = lerpScalar(0, 100, 0.25);
    assert.equal(typeof s === 'function' ? s(frame(0)) : s, 25);
  });
});

describe('resolvePoint cycle detection', () => {
  test('a cyclic center/at reference throws a clear, actionable error rather than a stack overflow', () => {
    const a = new Anchor({ id: 'cycle-a', name: 'A' });
    const b = new Anchor({ id: 'cycle-b', name: 'B' });
    a.cfg.at = b;
    b.cfg.at = a;

    assert.throws(
      () => a.position(frame(0)),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.notEqual(err.constructor.name, 'RangeError');
        assert.match(err.message, /resolution/i);
        return true;
      },
    );
  });

  test('a legitimately deep (non-cyclic) chain still resolves fine', () => {
    let prev: PointLike = { x: 1, y: 1 };
    for (let i = 0; i < 10; i++) {
      prev = new Anchor({ id: `chain-${i}`, name: `chain ${i}`, at: prev });
    }
    // prev is now the last anchor in a 10-deep chain, well under the guard.
    assert.ok(resolvePoint(prev, frame(0)));
  });
});
