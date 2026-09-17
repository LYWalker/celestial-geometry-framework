import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, type SceneTheme } from '../canvas-diagram/scene/scene.js';
import { Sphere } from '../canvas-diagram/scene/sphere.js';
import { Anchor } from '../canvas-diagram/scene/anchor.js';
import { frame } from '../canvas-diagram/scene/types.js';
import type { Camera } from '../canvas-diagram/camera.js';
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
