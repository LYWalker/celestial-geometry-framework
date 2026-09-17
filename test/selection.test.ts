import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../canvas-diagram/scene/scene.js';
import { Sphere } from '../canvas-diagram/scene/sphere.js';
import { Anchor } from '../canvas-diagram/scene/anchor.js';
import { Connector } from '../canvas-diagram/scene/connector.js';
import { Selection } from '../canvas-diagram/scene/selection.js';
import { describeScene } from '../canvas-diagram/scene/describe.js';
import { frame, resolvePoint } from '../canvas-diagram/scene/types.js';
import type { Camera } from '../canvas-diagram/camera.js';

const CAMERA: Camera = { zoom: 1, pan: { x: 0, y: 0 }, cx: 0, cy: 0 };

function build() {
  const earth = new Anchor({ id: 'earth', name: 'Earth', marker: 'cross' });
  const moon = new Sphere({ id: 'moon', name: 'Moon', center: earth, radius: 60, angle: 0, dotSize: 4 });
  const line = new Connector({ id: 'line', name: 'Line', from: earth, to: moon });
  const scene = new Scene().add(earth).add(moon).add(line);
  return { scene, earth, moon, line };
}

describe('Selection', () => {
  test('nothing selected means the camera holds the fallback', () => {
    const { scene, earth } = build();
    const sel = new Selection({ scene, fallback: earth });
    assert.equal(sel.id, null);
    assert.equal(sel.ref(), earth);
  });

  test('clicking a body follows it', () => {
    const { scene, earth, moon } = build();
    const sel = new Selection({ scene, fallback: earth });
    // the moon rides 60px along +x from the earth, and the camera is
    // centred on the earth at (0,0)
    const at = resolvePoint(moon, frame(0));
    sel.clickAt({ x: at.x, y: -at.y }, { f: frame(0), ref: earth, camera: CAMERA });
    assert.equal(sel.id, 'moon');
    assert.equal(sel.ref(), moon);
  });

  test('clicking it again lets go', () => {
    const { scene, earth, moon } = build();
    const sel = new Selection({ scene, fallback: earth });
    const at = resolvePoint(moon, frame(0));
    const click = () => sel.clickAt({ x: at.x, y: -at.y }, { f: frame(0), ref: earth, camera: CAMERA });
    click();
    click();
    assert.equal(sel.id, null);
  });

  test('a click on empty sky leaves the selection alone', () => {
    const { scene, earth } = build();
    const sel = new Selection({ scene, fallback: earth });
    sel.select('moon');
    assert.equal(sel.clickAt({ x: 900, y: 900 }, { f: frame(0), ref: earth, camera: CAMERA }), null);
    assert.equal(sel.id, 'moon');
  });

  test('...unless the figure asks for clearOnMiss', () => {
    const { scene, earth } = build();
    const sel = new Selection({ scene, fallback: earth });
    sel.select('moon');
    sel.clickAt({ x: 900, y: 900 }, { f: frame(0), ref: earth, camera: CAMERA, clearOnMiss: true });
    assert.equal(sel.id, null);
  });

  test('something with no position of its own is never followed', () => {
    const { scene, earth } = build();
    const sel = new Selection({ scene, fallback: earth });
    assert.equal(sel.select('line'), null);
    assert.equal(sel.id, null);
  });

  test('selectable() decides what may be followed at all', () => {
    const { scene, earth } = build();
    const sel = new Selection({ scene, fallback: earth, selectable: (i) => i.id === 'moon' });
    assert.equal(sel.select('earth'), null);
    assert.equal(sel.select('moon')?.id, 'moon');
  });

  test('onChange fires on a real change only', () => {
    const { scene, earth } = build();
    const seen: (string | null)[] = [];
    const sel = new Selection({ scene, fallback: earth, onChange: (item) => seen.push(item?.id ?? null) });
    sel.select('moon');
    sel.select('moon');
    sel.select(null);
    assert.deepEqual(seen, ['moon', null]);
  });

  test('an unknown id clears rather than throwing', () => {
    const { scene, earth } = build();
    const sel = new Selection({ scene, fallback: earth });
    sel.select('moon');
    assert.equal(sel.select('nope'), null);
    assert.equal(sel.id, null);
  });
});

describe('describeScene', () => {
  test('every named object becomes one readable line', () => {
    const earth = new Anchor({ id: 'earth', name: 'Earth', description: 'The centre.' });
    const moon = new Sphere({ id: 'moon', name: 'Moon', nameHe: 'ירח', center: earth, radius: 10 });
    const scene = new Scene().add(earth).add(moon);

    const lines = describeScene(scene);
    assert.deepEqual(
      lines.map((l) => l.text),
      ['Earth: The centre.', 'Moon'],
    );
    assert.equal(lines[1]!.nameHe, 'ירח');
  });

  test('the Hebrew name is opt-in', () => {
    const moon = new Sphere({ id: 'moon', name: 'Moon', nameHe: 'ירח', radius: 10 });
    const scene = new Scene().add(moon);
    assert.equal(describeScene(scene, { hebrew: true })[0]!.text, 'Moon (ירח)');
  });

  test('a filter leaves construction lines out', () => {
    const earth = new Anchor({ id: 'earth', name: 'Earth' });
    const line = new Connector({ id: 'line', name: 'Line', from: earth, toward: 0, length: 10 });
    const scene = new Scene().add(earth).add(line);

    const lines = describeScene(scene, { filter: (i) => i.kind !== 'connector' });
    assert.deepEqual(
      lines.map((l) => l.id),
      ['earth'],
    );
  });
});
