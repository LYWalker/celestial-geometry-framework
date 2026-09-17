import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Transitions } from '../canvas-diagram/scene/transitions.js';
import { near } from './helpers/near.js';

describe('Transitions', () => {
  test('a value eases toward its target rather than jumping', () => {
    const t = new Transitions({ shellT: 0 });
    t.set({ shellT: 1 });
    t.advance(0.1);
    const after = t.get('shellT');
    assert.ok(after > 0 && after < 1, `expected to be part-way, got ${after}`);
  });

  test('the same elapsed time gets to the same place however it is cut up', () => {
    const a = new Transitions({ x: 0 }).set({ x: 1 });
    const b = new Transitions({ x: 0 }).set({ x: 1 });
    a.advance(0.5);
    for (let i = 0; i < 50; i++) b.advance(0.01);
    // framerate independence: 1 - rate^dt composes, a fixed step per frame
    // would not
    assert.ok(near(a.get('x'), b.get('x'), 1e-9));
  });

  test('it settles exactly on the target and stops reporting movement', () => {
    const t = new Transitions({ x: 0 }).set({ x: 1 });
    let moving = true;
    for (let i = 0; i < 100 && moving; i++) moving = t.advance(0.05);
    assert.equal(t.get('x'), 1);
    assert.equal(t.settled(), true);
    assert.equal(t.advance(0.05), false);
  });

  test('target() is what the UI asked for, even mid-flight', () => {
    const t = new Transitions({ x: 0 }).set({ x: 1 });
    t.advance(0.01);
    assert.equal(t.target('x'), 1);
    assert.ok(t.get('x') < 1);
  });

  test('jump() arrives with no transition', () => {
    const t = new Transitions({ x: 0 }).jump({ x: 1 });
    assert.equal(t.get('x'), 1);
    assert.equal(t.settled(), true);
  });

  test('frame() carries the clock and every value by name', () => {
    const t = new Transitions({ shellT: 0.25, frameT: 0 });
    const f = t.frame(1234, { eccentric: 1 });
    assert.equal(f.t, 1234);
    assert.equal(f.shellT, 0.25);
    assert.equal(f.frameT, 0);
    assert.equal(f.eccentric, 1);
  });

  test('a Frame is a snapshot — advancing afterwards does not change it', () => {
    const t = new Transitions({ x: 0 }).set({ x: 1 });
    const f = t.frame(0);
    t.advance(0.5);
    assert.equal(f.x, 0);
  });

  test('a slower rate moves less in the same time', () => {
    const fast = new Transitions({ x: 0 }, { rate: 0.0001 }).set({ x: 1 });
    const slow = new Transitions({ x: 0 }, { rate: 0.5 }).set({ x: 1 });
    fast.advance(0.2);
    slow.advance(0.2);
    assert.ok(fast.get('x') > slow.get('x'));
  });
});
