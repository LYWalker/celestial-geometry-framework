import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Angle } from '../canvas-diagram/scene/angle.js';
import { frame } from '../canvas-diagram/scene/types.js';
import { near } from './helpers/near.js';

const VERTEX = { x: 0, y: 0 };

describe('Angle.valueAt — short: true (signed, the "correction" reading)', () => {
  test('the short way is a positive add when that is under 180 degrees', () => {
    // 350 -> 10 the short way is +20 (350 + 20 = 370 = 10 mod 360)
    const a = new Angle({ id: 'a1', name: 'A1', vertex: VERTEX, from: 350, to: 10, radius: 10, short: true });
    assert.ok(near(a.valueAt(frame(0)), 20));
  });

  test('the short way is a negative subtract the other direction', () => {
    // 10 -> 350 the short way is -20 (10 - 20 = -10 = 350 mod 360)
    const a = new Angle({ id: 'a2', name: 'A2', vertex: VERTEX, from: 10, to: 350, radius: 10, short: true });
    assert.ok(near(a.valueAt(frame(0)), -20));
  });

  test('short is the default when omitted', () => {
    const a = new Angle({ id: 'a3', name: 'A3', vertex: VERTEX, from: 350, to: 10, radius: 10 });
    assert.ok(near(a.valueAt(frame(0)), 20));
  });

  test('exactly 180 degrees either way is a boundary, not a crash', () => {
    const a = new Angle({ id: 'a4', name: 'A4', vertex: VERTEX, from: 0, to: 180, radius: 10, short: true });
    const v = a.valueAt(frame(0));
    assert.ok(near(Math.abs(v), 180));
  });
});

describe('Angle.valueAt — short: false (unsigned [0, 360), honours clockwise)', () => {
  test('anticlockwise (clockwise: false, the default): the long way round reads as a large positive number', () => {
    const a = new Angle({
      id: 'a5',
      name: 'A5',
      vertex: VERTEX,
      from: 10,
      to: 350,
      radius: 10,
      short: false,
      clockwise: false,
    });
    // anticlockwise from 10 to 350 the long way is 340 degrees
    assert.ok(near(a.valueAt(frame(0)), 340));
  });

  test('clockwise: true sweeps the other way', () => {
    const a = new Angle({
      id: 'a6',
      name: 'A6',
      vertex: VERTEX,
      from: 10,
      to: 350,
      radius: 10,
      short: false,
      clockwise: true,
    });
    // clockwise from 10 to 350 (through 0) is 20 degrees
    assert.ok(near(a.valueAt(frame(0)), 20));
  });

  test('clockwise defaults to false when short is false', () => {
    const a = new Angle({ id: 'a7', name: 'A7', vertex: VERTEX, from: 10, to: 350, radius: 10, short: false });
    assert.ok(near(a.valueAt(frame(0)), 340));
  });
});

describe('Angle.invalidate', () => {
  test('forces a recompute against the same Frame object', () => {
    const a = new Angle({ id: 'a8', name: 'A8', vertex: VERTEX, from: 0, to: 90, radius: 10 });
    const f = frame(0);
    assert.ok(near(a.valueAt(f), 90));
    a.cfg.to = 180;
    assert.ok(near(a.valueAt(f), 90), 'still cached — documented contract');
    a.invalidate();
    assert.ok(near(a.valueAt(f), 180));
  });
});
