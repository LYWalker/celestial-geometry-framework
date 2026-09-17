import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Sphere, nester } from '../canvas-diagram/scene/sphere.js';
import { Anchor } from '../canvas-diagram/scene/anchor.js';
import { frame } from '../canvas-diagram/scene/types.js';
import { nearVec } from './helpers/near.js';

describe('Sphere.position', () => {
  test('plain circular: centred on the origin, fixed angle', () => {
    const s = new Sphere({ id: 's1', name: 'S1', radius: 100, angle: 0 });
    assert.ok(nearVec(s.position(frame(0)), { x: 100, y: 0 }));

    const s2 = new Sphere({ id: 's2', name: 'S2', radius: 100, angle: 90 });
    assert.ok(nearVec(s2.position(frame(0)), { x: 0, y: -100 }));
  });

  test('eccentric offset: centre shifts away from `center` by ratio * radius, toward `direction`', () => {
    const earth = new Anchor({ id: 'earth', name: 'Earth' });
    const s = new Sphere({
      id: 'ecc',
      name: 'Eccentric',
      center: earth,
      radius: 100,
      eccentric: { ratio: 0.1, direction: 90 },
      angle: 0,
    });
    // centre offset 10 world px toward bearing 90 (straight up => y: -10)
    assert.ok(nearVec(s.centerAt(frame(0)), { x: 0, y: -10 }));
    // carried point: centre + polar(0, 100)
    assert.ok(nearVec(s.position(frame(0)), { x: 100, y: -10 }));
  });

  test('epicycle: a Sphere whose center is another Sphere rides the first one\'s current position', () => {
    const deferent = new Sphere({ id: 'deferent', name: 'Deferent', radius: 100, angle: 90 });
    const epicycle = new Sphere({ id: 'epicycle', name: 'Epicycle', center: deferent, radius: 10, angle: 0 });
    const f = frame(0);
    // deferent's carried point is at (0, -100); epicycle centres there
    assert.ok(nearVec(epicycle.centerAt(f), { x: 0, y: -100 }));
    assert.ok(nearVec(epicycle.position(f), { x: 10, y: -100 }));
  });

  test('measureFrom: angle measured from a point other than the circle\'s own centre', () => {
    const earth = new Anchor({ id: 'earth2', name: 'Earth' });
    // eccentric circle: own centre at (5, 0) (ratio 0.5 * radius 10, bearing 0)
    const s = new Sphere({
      id: 'measured',
      name: 'Measured',
      center: earth,
      radius: 10,
      eccentric: { ratio: 0.5, direction: 0 },
      measureFrom: earth, // the earth, NOT this sphere's own (5,0) centre
      angle: 0, // due east from the earth
    });
    const f = frame(0);
    assert.ok(nearVec(s.centerAt(f), { x: 5, y: 0 }));
    // hand-derived (see rayCircleFar's own test): far intersection is (15, 0)
    assert.ok(nearVec(s.position(f), { x: 15, y: 0 }));
  });
});

describe('Sphere memo aliasing (regression: position()/centerAt() used to return the memo itself)', () => {
  test('mutating a returned position() does not corrupt the cached value', () => {
    const s = new Sphere({ id: 'memo1', name: 'Memo1', radius: 50, angle: 0 });
    const f = frame(0);
    const p1 = s.position(f);
    p1.x = 99999;
    const p2 = s.position(f);
    assert.notEqual(p2.x, 99999);
    assert.ok(nearVec(p2, { x: 50, y: 0 }));
  });

  test('mutating a returned centerAt() does not corrupt the cached value', () => {
    const earth = new Anchor({ id: 'earth3', name: 'Earth' });
    const s = new Sphere({
      id: 'memo2',
      name: 'Memo2',
      center: earth,
      radius: 50,
      eccentric: { ratio: 0.2, direction: 0 },
      angle: 0,
    });
    const f = frame(0);
    const c1 = s.centerAt(f);
    c1.x = 99999;
    const c2 = s.centerAt(f);
    assert.notEqual(c2.x, 99999);
  });
});

describe('Sphere.invalidate (cfg-mutation contract)', () => {
  test('without invalidate(), a cfg change mid-frame is not picked up', () => {
    const s = new Sphere({ id: 'inv1', name: 'Inv1', radius: 10, angle: 0 });
    const f = frame(0);
    assert.equal(s.angleAt(f), 0);
    s.cfg.angle = 180;
    assert.equal(s.angleAt(f), 0, 'still cached — this is the documented contract, not a bug');
  });

  test('invalidate() forces a recompute against the same Frame object', () => {
    const s = new Sphere({ id: 'inv2', name: 'Inv2', radius: 10, angle: 0 });
    const f = frame(0);
    assert.equal(s.angleAt(f), 0);
    s.cfg.angle = 180;
    s.invalidate();
    assert.equal(s.angleAt(f), 180);
  });
});

describe('nester', () => {
  test('starts at `start` and steps by `gap`', () => {
    const n = nester(10, 5);
    assert.equal(n.next(), 10);
    assert.equal(n.next(), 15);
    assert.equal(n.next(), 20);
    assert.equal(n.next(), 25);
  });
});
