import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, type SceneTheme } from '../canvas-diagram/scene/scene.js';
import { Sphere } from '../canvas-diagram/scene/sphere.js';
import { Anchor } from '../canvas-diagram/scene/anchor.js';
import { Connector } from '../canvas-diagram/scene/connector.js';
import { Trail } from '../canvas-diagram/scene/trail.js';
import { frame } from '../canvas-diagram/scene/types.js';
import type { Camera } from '../canvas-diagram/camera.js';
import type { Vec } from '../canvas-diagram/geometry.js';
import type { HoverController } from '../canvas-diagram/hover.js';
import { makeFakeCtx } from './helpers/fakeCtx.js';
import { near } from './helpers/near.js';

const THEME: SceneTheme = {
  font: { css: '10px sans-serif', px: 10 },
  activeFont: { css: '10px sans-serif', px: 10 },
  subFont: { css: '10px sans-serif', px: 10 },
  noteFont: { css: '10px sans-serif', px: 10 },
  ink: '#fff',
  dim: '#888',
  halo: '#000',
  ring: '#f0f',
  body: '#fff',
  centerMark: '#f0f',
  angle: '#0ff',
  connector: '#ff0',
  trail: '#0f0',
};

function makeCamera(): Camera {
  return { zoom: 1, pan: { x: 0, y: 0 }, cx: 0, cy: 0 };
}

describe('Scene.draw label alpha (regression: labels.push used to ignore ambientAlpha)', () => {
  test('a body label\'s alpha is opacity * ambientAlpha, matching the drawn geometry', () => {
    const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'none' });
    const body = new Sphere({ id: 'body', name: 'Body', center: earth, radius: 10, angle: 0, opacity: 0.5 });
    const scene = new Scene().add(earth).add(body);

    const ctx = makeFakeCtx();
    ctx.globalAlpha = 0.4; // the caller's own whole-scene crossfade, set before draw()

    const labels = scene.draw({ ctx, f: frame(0), ref: earth, camera: makeCamera(), theme: THEME });
    const bodyLabel = labels.find((l) => l.text === 'Body');
    assert.ok(bodyLabel, 'expected a label for the body');
    assert.ok(near(bodyLabel!.alpha, 0.5 * 0.4), `expected 0.2, got ${bodyLabel!.alpha}`);
  });

  test('an anchor label\'s alpha is also opacity * ambientAlpha', () => {
    const earth = new Anchor({ id: 'earth2', name: 'Earth2', marker: 'cross', opacity: 0.8 });
    const scene = new Scene().add(earth);

    const ctx = makeFakeCtx();
    ctx.globalAlpha = 0.5;

    const labels = scene.draw({ ctx, f: frame(0), ref: earth, camera: makeCamera(), theme: THEME });
    const label = labels.find((l) => l.text === 'Earth2');
    assert.ok(label);
    assert.ok(near(label!.alpha, 0.8 * 0.5));
  });

  test('with no ambient alpha set (default 1), behaviour is unchanged from opacity alone', () => {
    const earth = new Anchor({ id: 'earth3', name: 'Earth3', marker: 'none' });
    const body = new Sphere({ id: 'body2', name: 'Body2', center: earth, radius: 10, angle: 0, opacity: 0.7 });
    const scene = new Scene().add(earth).add(body);

    const ctx = makeFakeCtx();
    const labels = scene.draw({ ctx, f: frame(0), ref: earth, camera: makeCamera(), theme: THEME });
    const label = labels.find((l) => l.text === 'Body2');
    assert.ok(label);
    assert.ok(near(label!.alpha, 0.7));
  });
});

describe('Scene.extent (what an auto-sized zodiac ring measures)', () => {
  test('reaches the far edge of a sphere ring, not just its centre', () => {
    const earth = new Anchor({ id: 'e', name: 'E', marker: 'none' });
    const shell = new Sphere({ id: 'shell', name: 'Shell', center: earth, radius: 120, showBody: false });
    const scene = new Scene().add(earth).add(shell);

    assert.ok(near(scene.extent(frame(0)), 120));
  });

  test('an off-centre ring is measured from the centre asked about, not its own', () => {
    const earth = new Anchor({ id: 'e2', name: 'E2', marker: 'none' });
    const shell = new Sphere({
      id: 'shell2',
      name: 'Shell2',
      center: { x: 30, y: 0 },
      radius: 100,
      showBody: false,
    });
    const scene = new Scene().add(earth).add(shell);

    assert.ok(near(scene.extent(frame(0)), 130));
  });

  test('a connector reaching past every ring sets the extent', () => {
    const earth = new Anchor({ id: 'e3', name: 'E3', marker: 'none' });
    const shell = new Sphere({ id: 'shell3', name: 'Shell3', center: earth, radius: 50, showBody: false });
    const sightline = new Connector({ id: 'sight', name: 'Sightline', from: earth, toward: 0, length: 200 });
    const scene = new Scene().add(earth).add(shell).add(sightline);

    assert.ok(near(scene.extent(frame(0)), 200));
  });

  test('excludeFromExtent leaves a sightline out — the ring it points at may not chase it', () => {
    const earth = new Anchor({ id: 'e4', name: 'E4', marker: 'none' });
    const shell = new Sphere({ id: 'shell4', name: 'Shell4', center: earth, radius: 50, showBody: false });
    const sightline = new Connector({
      id: 'sight2',
      name: 'Sightline2',
      from: earth,
      toward: 0,
      length: 200,
      excludeFromExtent: true,
    });
    const scene = new Scene().add(earth).add(shell).add(sightline);

    assert.ok(near(scene.extent(frame(0)), 50));
  });

  test('something faded out is not measured', () => {
    const earth = new Anchor({ id: 'e5', name: 'E5', marker: 'none' });
    const near1 = new Sphere({ id: 'near', name: 'Near', center: earth, radius: 40, showBody: false });
    const far = new Sphere({ id: 'far', name: 'Far', center: earth, radius: 400, showBody: false, opacity: 0 });
    const scene = new Scene().add(earth).add(near1).add(far);

    assert.ok(near(scene.extent(frame(0)), 40));
  });

  test('an anchor with marker "none" is never drawn, so never measured', () => {
    const earth = new Anchor({ id: 'e6', name: 'E6', marker: 'none' });
    const ghost = new Anchor({ id: 'ghost', name: 'Ghost', at: { x: 500, y: 0 }, marker: 'none' });
    const mark = new Anchor({ id: 'mark', name: 'Mark', at: { x: 80, y: 0 }, marker: 'cross' });
    const scene = new Scene().add(earth).add(ghost).add(mark);

    assert.ok(near(scene.extent(frame(0)), 80));
  });

  test('an empty scene reaches nowhere', () => {
    assert.equal(new Scene().extent(frame(0)), 0);
  });
});

describe('Scene trail anchoring (regression: a followed body left its trail behind)', () => {
  /** A stand-in HoverController that only records what got marked — enough
   * to read back where the trail's points actually landed on screen, which
   * is the whole question here. */
  function recordingHover(): { ctrl: HoverController; marks: Map<string, Vec[]> } {
    const marks = new Map<string, Vec[]>();
    const ctrl = {
      begin: () => undefined,
      mark: (pts: Vec[], _t: string, _s: string, _c: string, id?: string) => {
        if (id) marks.set(id, pts);
        return false;
      },
      markCircle: () => false,
    } as unknown as HoverController;
    return { ctrl, marks };
  }

  /** Earth at the origin; a planet on a ring about it; a trail of the
   * planet's own past, plotted relative to the earth — the orrery's shape,
   * in miniature. `angle` moves with the clock so the trail has somewhere
   * to have been. */
  function build() {
    const earth = new Anchor({ id: 'te', name: 'Earth', marker: 'none' });
    const planet = new Sphere({
      id: 'tp',
      name: 'Planet',
      center: earth,
      radius: 100,
      angle: (f) => f.t * 90,
      showRing: false,
    });
    const trail = new Trail({
      id: 'tt',
      name: 'Trail',
      target: planet,
      relativeTo: earth,
      span: 1,
      step: 0.25,
      dependsOn: [],
    });
    return { earth, planet, trail, scene: new Scene().add(earth).add(planet).add(trail) };
  }

  test('the trail ends on the body it trails, even when the camera follows that body', () => {
    const { planet, scene } = build();
    const f = frame(2);
    const { ctrl, marks } = recordingHover();

    // ref = the planet: what Selection.ref() returns once you click it.
    scene.draw({ ctx: makeFakeCtx(), f, ref: planet, camera: makeCamera(), theme: THEME, hover: ctrl });

    const pts = marks.get('tt:trail');
    assert.ok(pts && pts.length > 1, 'expected the trail to register a hover zone');
    const end = pts![pts!.length - 1]!;
    // The followed body sits at the camera's centre (cx/cy/pan all 0), and
    // the trail's newest sample *is* that body — so it must land there too.
    assert.ok(near(end.x, 0) && near(end.y, 0), `trail ended at ${end.x},${end.y}, not on the body it trails`);
  });

  test('following nothing in particular is unchanged: the trail still ends on its body', () => {
    const { earth, planet, scene } = build();
    const f = frame(2);
    const { ctrl, marks } = recordingHover();

    scene.draw({ ctx: makeFakeCtx(), f, ref: earth, camera: makeCamera(), theme: THEME, hover: ctrl });

    const pts = marks.get('tt:trail')!;
    const end = pts[pts.length - 1]!;
    const p = planet.position(f);
    assert.ok(near(end.x, p.x) && near(end.y, p.y), `trail ended at ${end.x},${end.y}, not at ${p.x},${p.y}`);
  });

  test('extent measures a trail from its own anchor, with no ref to be told', () => {
    const { scene } = build();
    // The planet's ring is 100 from the earth and the trail rides it, so
    // the scene reaches exactly 100 — whatever the camera is holding still.
    assert.ok(near(scene.extent(frame(2)), 100));
  });
});

describe('Scene.hitTest', () => {
  // camera centred on the origin at zoom 1, so world and screen coincide
  const camera = makeCamera();
  const f = frame(0);
  const earth = new Anchor({ id: 'earth', name: 'The earth', marker: 'cross' });
  const shell = new Sphere({ id: 'shell', name: 'A bare shell', center: earth, radius: 100, showBody: false });
  const sun = new Sphere({ id: 'sun', name: 'The sun', center: earth, radius: 50, angle: 0 });
  const line = new Connector({ id: 'line', name: 'A line', from: { x: -40, y: 80 }, to: { x: 40, y: 80 } });
  const scene = new Scene().add(earth).add(shell).add(sun).add(line);
  const at = (x: number, y: number, shapes?: boolean) =>
    scene.hitTest({ x, y }, { f, ref: { x: 0, y: 0 }, camera, ...(shapes !== undefined ? { shapes } : {}) })?.id ?? null;

  test('a rim or a line is not hit by default, so a figure that follows clicks never follows a bare shell', () => {
    assert.equal(at(0, -100), null);
    assert.equal(at(30, 80), null);
  });

  test('with shapes, anywhere on a rim or along a line is a hit', () => {
    assert.equal(at(0, -100, true), 'shell');
    assert.equal(at(-100, 0, true), 'shell');
    assert.equal(at(30, 80, true), 'line');
  });

  test('a body still wins over the rim it rides', () => {
    // the sun's body sits at (50, 0), on its own rim
    assert.equal(at(50, 0, true), 'sun');
  });
});

describe('an Anchor drawn as a body', () => {
  test('draws through its renderer instead of a marker, and is hit even with no marker', () => {
    const calls: { r: number; color: string }[] = [];
    const sun = new Anchor({
      id: 'sun',
      name: 'the sun',
      marker: 'none',
      color: '#e0b45c',
      dotSize: 8,
      render: (_ctx, b) => calls.push({ r: b.r, color: b.color }),
    });
    const scene = new Scene().add(sun);
    scene.draw({ ctx: makeFakeCtx(), f: frame(0), ref: sun, camera: makeCamera(), theme: THEME });
    assert.deepEqual(calls, [{ r: 8, color: '#e0b45c' }]);
    const hit = scene.hitTest({ x: 0, y: 0 }, { f: frame(0), ref: sun, camera: makeCamera() });
    assert.equal(hit?.id, 'sun');
  });
});
