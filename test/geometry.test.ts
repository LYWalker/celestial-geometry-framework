import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  norm360,
  polar,
  lonOf,
  clamp,
  unit,
  dot,
  add,
  sub,
  distToSegment,
  distToPolyline,
  arcPts,
  circlePts,
  clipToFrame,
} from '../canvas-diagram/geometry.js';
import { near, nearVec } from './helpers/near.js';

describe('norm360', () => {
  test('boundaries', () => {
    assert.equal(norm360(0), 0);
    assert.equal(norm360(360), 0);
    assert.equal(norm360(-1), 359);
    assert.equal(norm360(370), 10);
    assert.equal(norm360(-370), 350);
    assert.equal(norm360(720), 0);
  });
});

describe('polar / lonOf round-trip', () => {
  test('round-trips at many bearings, honouring the y-flip', () => {
    // polar()'s y is negated (canvas y is down, longitude runs
    // anticlockwise) — spot-check the flip directly at the cardinal points
    // before round-tripping generally.
    assert.ok(nearVec(polar(0, 10), { x: 10, y: 0 }));
    assert.ok(nearVec(polar(90, 10), { x: 0, y: -10 }));
    assert.ok(nearVec(polar(180, 10), { x: -10, y: 0 }));
    assert.ok(nearVec(polar(270, 10), { x: 0, y: 10 }));

    for (let lon = 0; lon < 360; lon += 7) {
      const p = polar(lon, 25);
      const back = lonOf(p);
      assert.ok(near(back, lon, 1e-6), `lonOf(polar(${lon})) = ${back}`);
    }
  });
});

describe('clamp', () => {
  test('clamps into range, passes values already inside', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
    assert.equal(clamp(0, 0, 10), 0);
    assert.equal(clamp(10, 0, 10), 10);
  });
});

describe('unit', () => {
  test('normalises to length 1', () => {
    const u = unit({ x: 3, y: 4 });
    assert.ok(near(Math.hypot(u.x, u.y), 1));
    assert.ok(nearVec(u, { x: 0.6, y: 0.8 }));
  });

  test('near-zero guard returns {1, 0} rather than dividing by ~0', () => {
    assert.deepEqual(unit({ x: 0, y: 0 }), { x: 1, y: 0 });
    assert.deepEqual(unit({ x: 1e-12, y: -1e-12 }), { x: 1, y: 0 });
  });
});

describe('dot / add / sub', () => {
  test('dot', () => {
    assert.equal(dot({ x: 1, y: 2 }, { x: 3, y: 4 }), 1 * 3 + 2 * 4);
  });
  test('add', () => {
    assert.deepEqual(add({ x: 1, y: 2 }, { x: 3, y: -4 }), { x: 4, y: -2 });
  });
  test('sub', () => {
    assert.deepEqual(sub({ x: 1, y: 2 }, { x: 3, y: -4 }), { x: -2, y: 6 });
  });
});

describe('distToSegment / distToPolyline', () => {
  test('distToSegment: point off the perpendicular midpoint', () => {
    // segment (0,0)-(10,0), point (5,5) — perpendicular foot at (5,0)
    assert.ok(near(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5));
  });
  test('distToSegment: closest point is an endpoint, not the perpendicular', () => {
    // point beyond the segment's end — t clamps to 1
    assert.ok(near(distToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5));
  });
  test('distToPolyline: degenerate single-point case', () => {
    assert.ok(near(distToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }]), 5));
  });
  test('distToPolyline: multi-segment picks the nearest segment', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    // closest to the second segment (10,0)-(10,10)
    assert.ok(near(distToPolyline({ x: 12, y: 5 }, pts), 2));
  });
});

describe('arcPts', () => {
  test('anticlockwise (cw=false): endpoints and sweep direction', () => {
    const pts = arcPts({ x: 0, y: 0 }, 10, 0, 90, false, 4);
    assert.equal(pts.length, 5);
    assert.ok(nearVec(pts[0]!, { x: 10, y: 0 }));
    assert.ok(nearVec(pts[4]!, { x: 0, y: -10 }));
    // midpoint at 45 degrees
    assert.ok(nearVec(pts[2]!, polar(45, 10)));
  });

  test('clockwise (cw=true): endpoints and sweep direction', () => {
    const pts = arcPts({ x: 0, y: 0 }, 10, 90, 0, true, 4);
    assert.equal(pts.length, 5);
    assert.ok(nearVec(pts[0]!, { x: 0, y: -10 }));
    assert.ok(nearVec(pts[4]!, { x: 10, y: 0 }));
    assert.ok(nearVec(pts[2]!, polar(45, 10)));
  });

  test('offset centre is applied', () => {
    const pts = arcPts({ x: 5, y: 5 }, 10, 0, 90, false, 2);
    assert.ok(nearVec(pts[0]!, { x: 15, y: 5 }));
  });
});

describe('circlePts', () => {
  test('closes the loop', () => {
    const pts = circlePts({ x: 0, y: 0 }, 10);
    assert.ok(pts.length > 1);
    assert.ok(nearVec(pts[0]!, pts[pts.length - 1]!));
  });
});

describe('clipToFrame', () => {
  const width = 100;
  const safeBottom = 100;
  const inset = 10;

  test('ray exits the right edge', () => {
    const r = clipToFrame({ x: 50, y: 50 }, { x: 1000, y: 50 }, inset, width, safeBottom);
    assert.equal(r.clipped, true);
    assert.ok(near(r.x, width - inset));
    assert.ok(near(r.y, 50));
  });

  test('ray exits the left edge', () => {
    const r = clipToFrame({ x: 50, y: 50 }, { x: -1000, y: 50 }, inset, width, safeBottom);
    assert.equal(r.clipped, true);
    assert.ok(near(r.x, inset));
  });

  test('ray exits the top edge', () => {
    const r = clipToFrame({ x: 50, y: 50 }, { x: 50, y: -1000 }, inset, width, safeBottom);
    assert.equal(r.clipped, true);
    assert.ok(near(r.y, inset));
  });

  test('ray exits the bottom edge, honouring safeBottom/bottomInset', () => {
    const r = clipToFrame({ x: 50, y: 50 }, { x: 50, y: 1000 }, inset, width, safeBottom, 14);
    assert.equal(r.clipped, true);
    assert.ok(near(r.y, safeBottom - 14));

    // a smaller bottomInset pushes the clip line further down
    const r2 = clipToFrame({ x: 50, y: 50 }, { x: 50, y: 1000 }, inset, width, safeBottom, 0);
    assert.ok(near(r2.y, safeBottom));
    assert.ok(r2.y > r.y);
  });

  test('a ray that stays inside the frame is not clipped', () => {
    const r = clipToFrame({ x: 50, y: 50 }, { x: 55, y: 55 }, inset, width, safeBottom);
    assert.equal(r.clipped, false);
    assert.equal(r.t, 1);
    assert.ok(near(r.x, 55));
    assert.ok(near(r.y, 55));
  });
});
