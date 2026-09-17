import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../canvas-diagram/scene/scene.js';
import { Sphere } from '../canvas-diagram/scene/sphere.js';
import { Connector } from '../canvas-diagram/scene/connector.js';
import { Anchor } from '../canvas-diagram/scene/anchor.js';
import { Stage } from '../canvas-diagram/scene/stage.js';
import { ZodiacRing, ZODIAC_AUTO_PADDING, type ZodiacConfig } from '../canvas-diagram/scene/zodiac.js';
import { frame } from '../canvas-diagram/scene/types.js';
import { makeFakeCtx } from './helpers/fakeCtx.js';
import { near } from './helpers/near.js';

/** Only Stage's constructor touches the canvas at all, and only to ask for
 * a 2D context — zodiacGeometry() below is pure arithmetic over the Scene.
 * That's the whole DOM surface these tests need, so it's stubbed here rather
 * than pulling a real canvas in (see fakeCtx's own note). */
function makeStage(zodiac: ZodiacConfig | ZodiacRing | false): Stage {
  const ctx = makeFakeCtx();
  const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
  return new Stage({ canvas, zodiac });
}

const SEGMENTS = Array.from({ length: 12 }, (_, i) => ({ name: `S${i}` }));

function sceneReaching(radius: number): Scene {
  const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
  const shell = new Sphere({ id: 'shell', name: 'Shell', center: earth, radius, showBody: false });
  return new Scene().add(earth).add(shell);
}

describe('Stage.zodiacGeometry (auto-sizing the zodiac ring)', () => {
  test('an explicit radius is used as given, scene or no scene', () => {
    const stage = makeStage({ radius: 200, band: 20, segments: SEGMENTS });
    const geom = stage.zodiacGeometry(frame(0), sceneReaching(50));
    assert.ok(geom);
    assert.ok(near(geom!.radius, 200));
    assert.ok(near(geom!.outer, 220));
  });

  test('with no radius, the ring clears the scene by the default padding', () => {
    const stage = makeStage({ band: 20, segments: SEGMENTS });
    const geom = stage.zodiacGeometry(frame(0), sceneReaching(150));
    assert.ok(geom);
    assert.ok(near(geom!.radius, 150 + ZODIAC_AUTO_PADDING));
    assert.ok(near(geom!.outer, 150 + ZODIAC_AUTO_PADDING + 20));
  });

  test('padding is adjustable', () => {
    const stage = makeStage({ radius: 'auto', padding: 4, band: 10, segments: SEGMENTS });
    const geom = stage.zodiacGeometry(frame(0), sceneReaching(150));
    assert.ok(near(geom!.radius, 154));
  });

  test('the band defaults to a fraction of whatever radius was resolved', () => {
    const stage = makeStage({ padding: 0, segments: SEGMENTS });
    const geom = stage.zodiacGeometry(frame(0), sceneReaching(100));
    assert.ok(near(geom!.band, 18));
    assert.ok(near(geom!.outer, 118));
  });

  test('a grown scene grows the ring — the point of auto-sizing', () => {
    const stage = makeStage({ padding: 10, band: 10, segments: SEGMENTS });
    const scene = sceneReaching(100);
    assert.ok(near(stage.zodiacGeometry(frame(0), scene)!.radius, 110));

    scene.add(new Sphere({ id: 'outer', name: 'Outer', radius: 300, showBody: false }));
    // a different Frame, so this isn't the memoised answer from above
    assert.ok(near(stage.zodiacGeometry(frame(1), scene)!.radius, 310));
  });

  test('the Scene is remembered, so a resize handler can ask without one', () => {
    const stage = makeStage({ padding: 10, band: 10, segments: SEGMENTS });
    stage.zodiacGeometry(frame(0), sceneReaching(100));
    assert.ok(near(stage.zodiacGeometry(frame(1))!.radius, 110));
  });

  test('an auto ring asked for before any Scene has been seen reports nothing', () => {
    const stage = makeStage({ segments: SEGMENTS });
    assert.equal(stage.zodiacGeometry(frame(0)), null);
  });

  test("fit: 'grow' keeps the ring at the furthest the scene has ever reached", () => {
    const stage = makeStage({ padding: 10, band: 10, fit: 'grow', segments: SEGMENTS });
    const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
    // an outermost object that swings in and out, the way an eccentric
    // planet's distance does — the case a per-frame ring would breathe with
    const planet = new Sphere({
      id: 'planet',
      name: 'Planet',
      center: earth,
      radius: (f) => 100 + 20 * f.t,
      showBody: false,
    });
    const scene = new Scene().add(earth).add(planet);

    assert.ok(near(stage.zodiacGeometry(frame(0), scene)!.radius, 110));
    assert.ok(near(stage.zodiacGeometry(frame(1), scene)!.radius, 130));
    // back in, but the ring stays out
    assert.ok(near(stage.zodiacGeometry(frame(0.5), scene)!.radius, 130));
  });

  test("the default fit follows the scene back in, unlike 'grow'", () => {
    const stage = makeStage({ padding: 10, band: 10, segments: SEGMENTS });
    const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
    const planet = new Sphere({
      id: 'planet',
      name: 'Planet',
      center: earth,
      radius: (f) => 100 + 20 * f.t,
      showBody: false,
    });
    const scene = new Scene().add(earth).add(planet);

    assert.ok(near(stage.zodiacGeometry(frame(1), scene)!.radius, 130));
    assert.ok(near(stage.zodiacGeometry(frame(0), scene)!.radius, 110));
  });

  test('no zodiac configured, no geometry', () => {
    assert.equal(makeStage(false).zodiacGeometry(frame(0), sceneReaching(100)), null);
  });

  test('setZodiac re-resolves rather than handing back the previous ring', () => {
    const stage = makeStage({ radius: 200, band: 20, segments: SEGMENTS });
    const f = frame(0);
    assert.ok(near(stage.zodiacGeometry(f, sceneReaching(50))!.radius, 200));
    stage.setZodiac({ padding: 10, band: 20, segments: SEGMENTS });
    assert.ok(near(stage.zodiacGeometry(f)!.radius, 60));
  });
});

describe('ZodiacRing as the thing a figure draws lines to', () => {
  test('ring.outer is a Scalar a Connector can take as its length', () => {
    const ring = new ZodiacRing({ padding: 10, band: 10, segments: SEGMENTS });
    const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
    const shell = new Sphere({ id: 'shell', name: 'Shell', center: earth, radius: 100, showBody: false });
    const dial = new Connector({ id: 'dial', name: 'Dial', from: earth, toward: 0, length: ring.outer });
    const scene = new Scene().add(earth).add(shell).add(dial);
    ring.fitTo(scene);

    // 100 + 10 padding = 110 inner, + 10 band = 120 outer
    assert.ok(near(ring.outer(frame(0)), 120));
    assert.ok(near(dial.toAt(frame(0)).x, 120));
  });

  test('a dial line still reaches the ring in the frame the ring measured in', () => {
    const ring = new ZodiacRing({ padding: 10, band: 10, segments: SEGMENTS });
    const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
    const shell = new Sphere({ id: 'shell', name: 'Shell', center: earth, radius: 100, showBody: false });
    const dial = new Connector({ id: 'dial', name: 'Dial', from: earth, toward: 0, length: ring.outer });
    const scene = new Scene().add(earth).add(shell).add(dial);
    ring.fitTo(scene);

    // one Frame, measured first and drawn second — exactly a render's own
    // order. The measurement resolves the dial while the ring reads 0; the
    // draw must not then be handed that memoised zero-length line.
    const f = frame(0);
    assert.ok(near(ring.outer(f), 120));
    assert.ok(near(dial.toAt(f).x, 120));
  });

  test("a line drawn out to the ring doesn't push the ring out — no flag needed", () => {
    const ring = new ZodiacRing({ padding: 10, band: 10, segments: SEGMENTS });
    const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
    const shell = new Sphere({ id: 'shell', name: 'Shell', center: earth, radius: 100, showBody: false });
    const dial = new Connector({ id: 'dial', name: 'Dial', from: earth, toward: 0, length: ring.outer });
    const scene = new Scene().add(earth).add(shell).add(dial);
    ring.fitTo(scene);

    // measured fresh each frame: were the dial counted, each frame's ring
    // would sit outside the last one's, forever
    assert.ok(near(ring.inner(frame(0)), 110));
    assert.ok(near(ring.inner(frame(1)), 110));
    assert.ok(near(ring.inner(frame(2)), 110));
  });

  test('a growing ring stays put when the dial line is resolved first (regression)', () => {
    // The order that broke it: something asks the *dial* about a frame
    // before the ring has measured that frame — a hit-test, a readout, or
    // simply Scene.draw reaching the connector first. Resolving the dial
    // resolves `ring.outer`, which measures the scene, which reads the dial
    // back mid-resolution. When that read returned the previous frame's
    // endpoint, the ring measured a line as long as the last ring, cleared
    // it by `padding`, and did it again every frame — with `fit: 'grow'`
    // ratcheting the result up forever.
    const ring = new ZodiacRing({ padding: 10, band: 10, fit: 'grow', segments: SEGMENTS });
    const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
    const shell = new Sphere({ id: 'shell', name: 'Shell', center: earth, radius: 100, showBody: false });
    const dial = new Connector({ id: 'dial', name: 'Dial', from: earth, toward: 0, length: ring.outer });
    const scene = new Scene().add(earth).add(shell).add(dial);
    ring.fitTo(scene);

    const radii: number[] = [];
    for (let i = 0; i < 6; i++) {
      const f = frame(i);
      dial.toAt(f); // the dial first, the ring second
      radii.push(ring.inner(f));
    }
    assert.deepEqual(
      radii.map((r) => Math.round(r)),
      [110, 110, 110, 110, 110, 110],
      `ring ran away: ${radii.map((r) => r.toFixed(1)).join(' -> ')}`,
    );
  });

  test('warm() opens a growing ring at its final size before the first draw', () => {
    const ring = new ZodiacRing({ padding: 10, band: 10, fit: 'grow', segments: SEGMENTS });
    const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
    const planet = new Sphere({
      id: 'planet',
      name: 'Planet',
      center: earth,
      radius: (f) => 100 + 20 * f.t,
      showBody: false,
    });
    ring.fitTo(new Scene().add(earth).add(planet));

    ring.warm([frame(0), frame(0.5), frame(1)]);
    // t = 0 would measure 110 on its own; the warmed mark holds it at 130
    assert.ok(near(ring.inner(frame(0)), 130));
  });

  test('freeze() keeps the size and lets the centre keep moving', () => {
    const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
    const planet = new Sphere({
      id: 'planet',
      name: 'Planet',
      center: earth,
      radius: (f) => 100 + 20 * f.t,
      showBody: false,
    });
    const scene = new Scene().add(earth).add(planet);
    const ring = new ZodiacRing({
      padding: 10,
      band: 10,
      fit: 'grow',
      segments: SEGMENTS,
      center: (f) => ({ x: 50 * f.t, y: 0 }),
    });
    ring.fitTo(scene);

    ring.warm([frame(0), frame(0.5), frame(1)]).freeze();
    // the largest view it was shown — at t = 1 the centre has moved 50 out
    // from the planet's own centre, so the far side of its ring is 170 away
    // — and it stays there, however small the picture gets afterwards
    assert.ok(near(ring.inner(frame(0)), 180));
    assert.ok(near(ring.inner(frame(1)), 180));
    assert.ok(near(ring.inner(frame(9)), 180));
    // but the centre still tracks the frame
    assert.ok(near(ring.geometry(frame(2))!.center.x, 100));
  });

  test('a Stage draws the very ring the figure holds', () => {
    const ring = new ZodiacRing({ padding: 10, band: 10, segments: SEGMENTS });
    const stage = makeStage(ring);
    const scene = sceneReaching(100);

    assert.ok(near(stage.zodiacGeometry(frame(0), scene)!.outer, 120));
    // and the figure's own copy now measures that same scene
    assert.ok(near(ring.outer(frame(1)), 120));
  });
});
