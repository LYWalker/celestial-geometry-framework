import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Connector } from '../canvas-diagram/scene/connector.js';
import { frame } from '../canvas-diagram/scene/types.js';
import { nearVec } from './helpers/near.js';

describe('Connector', () => {
  test('constructor throws when neither `to` nor `toward` is given', () => {
    assert.throws(() => new Connector({ id: 'bad', name: 'Bad', from: { x: 0, y: 0 } } as never), /needs either/);
  });

  test('fromAt/toAt resolve `to` directly', () => {
    const c = new Connector({ id: 'c1', name: 'C1', from: { x: 0, y: 0 }, to: { x: 10, y: 20 } });
    const f = frame(0);
    assert.ok(nearVec(c.fromAt(f), { x: 0, y: 0 }));
    assert.ok(nearVec(c.toAt(f), { x: 10, y: 20 }));
  });

  test('toward/length builds the other end from a bearing', () => {
    const c = new Connector({ id: 'c2', name: 'C2', from: { x: 0, y: 0 }, toward: 0, length: 10 });
    assert.ok(nearVec(c.toAt(frame(0)), { x: 10, y: 0 }));
  });

  test('shorten pulls the far end back along the line, not past `from`', () => {
    const c = new Connector({ id: 'c3', name: 'C3', from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, shorten: 3 });
    assert.ok(nearVec(c.toAt(frame(0)), { x: 7, y: 0 }));
  });
});

describe('Connector memo aliasing (regression: fromAt()/toAt() used to return the memo itself)', () => {
  test('mutating a returned fromAt()/toAt() does not corrupt the cached value', () => {
    const c = new Connector({ id: 'c4', name: 'C4', from: { x: 1, y: 1 }, to: { x: 10, y: 20 } });
    const f = frame(0);
    const a = c.fromAt(f);
    a.x = 99999;
    assert.ok(nearVec(c.fromAt(f), { x: 1, y: 1 }));

    const b = c.toAt(f);
    b.y = -99999;
    assert.ok(nearVec(c.toAt(f), { x: 10, y: 20 }));
  });
});

describe('Connector.invalidate', () => {
  test('forces a recompute against the same Frame object', () => {
    const c = new Connector({ id: 'c5', name: 'C5', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } });
    const f = frame(0);
    assert.ok(nearVec(c.toAt(f), { x: 5, y: 5 }));
    c.cfg.to = { x: 9, y: 9 };
    assert.ok(nearVec(c.toAt(f), { x: 5, y: 5 }), 'still cached — documented contract');
    c.invalidate();
    assert.ok(nearVec(c.toAt(f), { x: 9, y: 9 }));
  });
});
