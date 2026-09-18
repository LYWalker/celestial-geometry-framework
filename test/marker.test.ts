import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RingMarker } from '../canvas-diagram/scene/marker.js';
import { Anchor } from '../canvas-diagram/scene/anchor.js';
import { frame } from '../canvas-diagram/scene/types.js';
import { lonOf, polar } from '../canvas-diagram/geometry.js';
import { near } from './helpers/near.js';

/**
 * The Rambam orrery's own numbers, so the error these tests are about is the
 * size it really is there rather than one invented to make a point: the ring
 * is the ninth galgal at 330 world px, the sun's circle is the fourth at
 * 157.5, and its centre sits off the earth by sin(1°59′) of its own radius —
 * the offset that produces his whole equation of the sun. The moon's large
 * circle is the first galgal at 54, off-centre by 10;19 / 49;41 of that.
 */
const RING = 330;
const SUN_OFFSET = Math.sin((1 + 59 / 60) * (Math.PI / 180)) * 157.5;
const MOON_OFFSET = ((10 + 19 / 60) / (49 + 41 / 60)) * 54;

/** The longitude a reading is actually drawn at, seen from the ring's centre. */
const bearingOf = (m: RingMarker, f: ReturnType<typeof frame>) => lonOf(m.position(f));

function ringAt(offset: number, offsetLon: number, toward: number, parallax?: 'none' | 'finite') {
  const earth = new Anchor({
    id: 'earth',
    name: 'Earth',
    at: { x: 0, y: 0 },
    marker: 'none',
  });
  const pivot = new Anchor({
    id: 'pivot',
    name: 'Pivot',
    at: polar(offsetLon, offset),
    marker: 'none',
  });
  return new RingMarker({
    id: 'reading',
    name: 'Reading',
    center: earth,
    radius: RING,
    pivot,
    toward,
    ...(parallax ? { parallax } : {}),
  });
}

describe('RingMarker at infinity (the ring stands in for the sky)', () => {
  test('a true place — sighted from the centre — lands at its own longitude', () => {
    const m = ringAt(0, 0, 195.73);
    assert.ok(near(bearingOf(m, frame(0)), 195.73, 1e-9));
  });

  test("a mean place sighted from the sun's own off-centre circle lands there too", () => {
    // The offset is at right angles to the direction read, which is where a
    // finite ring's parallax is at its worst.
    const m = ringAt(SUN_OFFSET, 195.73 + 90, 195.73);
    assert.ok(
      near(bearingOf(m, frame(0)), 195.73, 1e-9),
      `the mean sun read ${bearingOf(m, frame(0)).toFixed(3)}°, not 195.73°`,
    );
  });

  test('parallax: "finite" is the other answer, and on this figure it is about a degree out', () => {
    const f = frame(0);
    const finite = ringAt(SUN_OFFSET, 195.73 + 90, 195.73, 'finite');
    const err = Math.abs(bearingOf(finite, f) - 195.73);
    assert.ok(err > 0.8 && err < 1.1, `expected the sun's parallax to be ~0.95°, got ${err.toFixed(3)}°`);
  });

  test("the moon's is worse — nearly two degrees, a fifteenth of a sign", () => {
    const f = frame(0);
    const finite = ringAt(MOON_OFFSET, 100, 10, 'finite');
    const infinite = ringAt(MOON_OFFSET, 100, 10);
    assert.ok(near(bearingOf(infinite, f), 10, 1e-9));
    const err = Math.abs(bearingOf(finite, f) - 10);
    assert.ok(err > 1.5 && err < 2.1, `expected ~1.95°, got ${err.toFixed(3)}°`);
  });

  test('a reading never leaves the sign its own longitude names', () => {
    // 29°30′ of Virgo: half a degree from the boundary, and every offset
    // direction in turn — under the old placement some of these crossed into
    // Libra and the tick sat under the wrong name.
    const lon = 179.5;
    for (let d = 0; d < 360; d += 15) {
      const m = ringAt(MOON_OFFSET, d, lon);
      const read = bearingOf(m, frame(0));
      assert.equal(Math.floor(read / 30), Math.floor(lon / 30), `offset at ${d}° pushed the reading to ${read}°`);
    }
  });

  test('with no offset at all the two agree exactly, whatever the bearing', () => {
    for (let lon = 0; lon < 360; lon += 37) {
      const a = ringAt(0, 0, lon);
      const b = ringAt(0, 0, lon, 'finite');
      assert.ok(near(bearingOf(a, frame(0)), bearingOf(b, frame(0)), 1e-9));
    }
  });
});
