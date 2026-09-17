/**
 * Tilted planes: the projection itself, and the Sphere that rides one.
 *
 * The assertions here are deliberately against the *astronomy*, not against
 * whatever the code happens to produce. A tilted circle projected onto the
 * page is not a drawing trick with a plausible look — it is the same
 * relation between argument of latitude, ecliptic longitude and ecliptic
 * latitude that a real orbit has, and if that stops being true the figures
 * built on it quietly start lying.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEG, lonOf, norm360, onPlane, planeArcPts } from '../canvas-diagram/geometry.js';
import { Anchor, Sphere, frame } from '../canvas-diagram/scene/index.js';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('onPlane', () => {
  test('a plane with no tilt is just polar()', () => {
    for (const lon of [0, 37, 90, 180, 271, 359]) {
      const p = onPlane(lon, 100, { tilt: 0, nodes: 40 });
      assert.ok(near(p.x, 100 * Math.cos(lon * DEG), 1e-9));
      assert.ok(near(p.y, -100 * Math.sin(lon * DEG), 1e-9));
      assert.ok(near(p.depth, 0));
    }
  });

  test('nothing is foreshortened along the line of nodes, and nothing leaves the page there', () => {
    const plane = { tilt: 60, nodes: 25 };
    for (const lon of [25, 25 + 180]) {
      const p = onPlane(lon, 100, plane);
      // still the full radius from the centre, however steep the tilt
      assert.ok(near(Math.hypot(p.x, p.y), 100, 1e-9));
      assert.ok(near(lonOf(p), norm360(lon), 1e-9));
      assert.ok(near(p.depth, 0, 1e-9));
    }
  });

  test('a quarter turn from the nodes is where it stands furthest out of the page', () => {
    const r = 100;
    const plane = { tilt: 30, nodes: 0 };
    const up = onPlane(90, r, plane);
    const down = onPlane(270, r, plane);
    assert.ok(near(up.depth, r * Math.sin(30 * DEG), 1e-9));
    assert.ok(near(down.depth, -r * Math.sin(30 * DEG), 1e-9));
    // and where the projection is most foreshortened: the semi-minor axis
    assert.ok(near(Math.hypot(up.x, up.y), r * Math.cos(30 * DEG), 1e-9));
  });

  test('the projected bearing is the ecliptic longitude of that argument of latitude', () => {
    // tan(lambda - node) = tan(u - node) * cos(i) — the standard relation.
    const i = 23.5;
    const node = 71;
    for (const u of [10, 55, 120, 200, 300, 349]) {
      const p = onPlane(u, 140, { tilt: i, nodes: node });
      const expected = Math.atan2(Math.sin((u - node) * DEG) * Math.cos(i * DEG), Math.cos((u - node) * DEG)) / DEG;
      assert.ok(near(norm360(lonOf(p) - node), norm360(expected), 1e-9));
    }
  });

  test('depth is r*sin(beta) for the real ecliptic latitude beta', () => {
    // sin(beta) = sin(u - node) * sin(i)
    const i = 5.145; // the moon
    const node = 210;
    const r = 120;
    for (const u of [0, 44, 91, 175, 260, 333]) {
      const beta = Math.asin(Math.sin((u - node) * DEG) * Math.sin(i * DEG));
      assert.ok(near(onPlane(u, r, { tilt: i, nodes: node }).depth, r * Math.sin(beta), 1e-9));
    }
  });

  test('planeArcPts walks the rim from the centre it is given', () => {
    const pts = planeArcPts({ x: 30, y: -12 }, 50, { tilt: 40, nodes: 0 }, 0, 360, 64);
    assert.equal(pts.length, 65);
    // first and last close the loop
    assert.ok(near(pts[0]!.x, pts[64]!.x, 1e-9));
    assert.ok(near(pts[0]!.y, pts[64]!.y, 1e-9));
    // every point is inside the circumscribing circle about that centre
    for (const p of pts) assert.ok(Math.hypot(p.x - 30, p.y + 12) <= 50 + 1e-9);
  });
});

describe('Sphere on a tilted plane', () => {
  const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });

  test('its carried body rides the projected rim, and reports its own depth', () => {
    const orbit = new Sphere({
      id: 'orbit',
      name: 'Orbit',
      center: earth,
      radius: 100,
      plane: { tilt: 30, nodes: 0 },
      angle: (f) => f.t,
    });
    const at90 = orbit.position(frame(90));
    assert.ok(near(at90.x, 0, 1e-9));
    assert.ok(near(at90.y, -100 * Math.cos(30 * DEG), 1e-9));
    assert.ok(near(orbit.depthAt(frame(90)), 100 * Math.sin(30 * DEG), 1e-9));
    // at the node it is back on the flat plane, at full radius
    assert.ok(near(orbit.depthAt(frame(0)), 0, 1e-9));
    assert.ok(near(orbit.position(frame(0)).x, 100, 1e-9));
  });

  test('a flat sphere reports no depth at all', () => {
    const flat = new Sphere({ id: 'flat', name: 'Flat', radius: 100, angle: (f) => f.t });
    assert.equal(flat.planeAt(frame(37)), null);
    assert.equal(flat.depthAt(frame(37)), 0);
  });

  test('the tilt and the nodes may both move', () => {
    const orbit = new Sphere({
      id: 'orbit2',
      name: 'Orbit',
      radius: 100,
      // exaggerated under a control, with nodes that regress
      plane: { tilt: (f) => 5 * (f.exaggerate ?? 1), nodes: (f) => -f.t },
      angle: 90,
    });
    assert.ok(near(orbit.planeAt(frame(0, { exaggerate: 4 }))!.tilt, 20));
    assert.ok(near(orbit.planeAt(frame(30, { exaggerate: 1 }))!.nodes, 330));
    // and with the nodes swung round to the body itself, it is back on the
    // flat plane however steep the tilt
    assert.ok(near(orbit.depthAt(frame(-90, { exaggerate: 8 })), 0, 1e-9));
  });

  test('rimAt closes the ellipse and splits cleanly at the nodes', () => {
    const orbit = new Sphere({
      id: 'orbit3',
      name: 'Orbit',
      radius: 80,
      plane: { tilt: 45, nodes: 17 },
      showBody: false,
    });
    const f = frame(0);
    const nearHalf = orbit.rimAt(f, 17, 17 + 180, 32);
    const farHalf = orbit.rimAt(f, 17 + 180, 17 + 360, 32);
    // the halves meet exactly at the nodes, where depth is zero
    assert.ok(near(nearHalf[0]!.depth, 0, 1e-9));
    assert.ok(near(nearHalf[32]!.depth, 0, 1e-9));
    assert.ok(near(nearHalf[32]!.x, farHalf[0]!.x, 1e-9));
    // and one half is wholly in front, the other wholly behind
    assert.ok(nearHalf.slice(1, 32).every((p) => p.depth > 0));
    assert.ok(farHalf.slice(1, 32).every((p) => p.depth < 0));
  });

  test('asking for a single point does not divide by zero', () => {
    // `n = 0` is what a label or a node marker asks for: one point, at
    // `from`. It used to compute 0/0, and the NaN surfaced far away — as a
    // label direction, which took the whole label pass down with it.
    const orbit = new Sphere({
      id: 'orbit5',
      name: 'Orbit',
      radius: 100,
      plane: { tilt: 30, nodes: 45 },
      showBody: false,
    });
    const one = orbit.rimAt(frame(0), 45, 45, 0);
    assert.equal(one.length, 1);
    assert.ok(Number.isFinite(one[0]!.x));
    assert.ok(Number.isFinite(one[0]!.y));
    assert.ok(near(one[0]!.depth, 0, 1e-9));
    // and the flat path has the same hazard, and the same guard
    const flat = new Sphere({ id: 'flat2', name: 'Flat', radius: 100, showBody: false });
    assert.ok(Number.isFinite(flat.rimAt(frame(0), 90, 90, 0)[0]!.x));
    assert.ok(Number.isFinite(planeArcPts({ x: 0, y: 0 }, 10, { tilt: 20, nodes: 0 }, 5, 5, 0)[0]!.x));
  });

  test('an eccentric offset is foreshortened with its own plane', () => {
    const orbit = new Sphere({
      id: 'orbit4',
      name: 'Orbit',
      radius: 100,
      // offset a quarter turn from the nodes, where foreshortening is worst
      eccentric: { ratio: 0.5, direction: 90 },
      plane: { tilt: 60, nodes: 0 },
      showBody: false,
    });
    const c = orbit.centerAt(frame(0));
    assert.ok(near(c.x, 0, 1e-9));
    assert.ok(near(c.y, -50 * Math.cos(60 * DEG), 1e-9));
  });

  test('plane and measureFrom are rejected together, not silently mixed', () => {
    assert.throws(
      () =>
        new Sphere({
          id: 'bad',
          name: 'Bad',
          radius: 100,
          plane: { tilt: 10, nodes: 0 },
          measureFrom: earth,
          angle: 0,
        }),
      /plane.*measureFrom|measureFrom.*plane/s,
    );
  });
});
