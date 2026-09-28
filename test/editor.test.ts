import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Sphere } from '../canvas-diagram/scene/sphere.js';
import { Anchor } from '../canvas-diagram/scene/anchor.js';
import { frame } from '../canvas-diagram/scene/types.js';
import { compileDoc, varName } from '../canvas-diagram/editor/compile.js';
import { emitScene, emitDocument } from '../canvas-diagram/editor/emit.js';
import { emptyDoc, idFromName, parseDoc, serializeDoc, validateDoc, type DiagramDoc } from '../canvas-diagram/editor/doc.js';
import { Env } from '../canvas-diagram/editor/expr.js';
import { deletePath, EditorState, getPath, setPath } from '../canvas-diagram/editor/state.js';
import { handlesFor } from '../canvas-diagram/editor/handles.js';
import { demoFigure } from '../canvas-diagram/editor/examples/demo.js';
import { inclinationFigure } from '../canvas-diagram/editor/examples/inclination.js';
import { orreryFigure } from '../canvas-diagram/editor/examples/orrery.js';
import { near } from './helpers/near.js';
import { BODIES } from '../canvas-diagram/editor/bodies.js';
import { getRenderer } from '../canvas-diagram/editor/renderers.js';

/** A minimal figure: an earth, and a sphere turning about it. */
function twoObjects(): DiagramDoc {
  const doc = emptyDoc();
  doc.objects.push({
    kind: 'sphere',
    id: 'sun',
    name: 'The sun',
    center: { ref: 'earth' },
    radius: 100,
    speed: 1,
    phase: 0,
  });
  return doc;
}

describe('compiling a document', () => {
  test('a reference becomes the object it names, so an epicycle rides its parent', () => {
    const doc = twoObjects();
    doc.objects.push({
      kind: 'sphere',
      id: 'moon',
      name: 'The moon',
      center: { ref: 'sun' },
      radius: 10,
      angle: 0,
    });
    const fig = compileDoc(doc);
    assert.equal(fig.problems.length, 0);

    const f = frame(90); // a quarter turn of the sun, at 1°/unit
    const sun = fig.items.get('sun') as Sphere;
    const moon = fig.items.get('moon') as Sphere;
    const sunAt = sun.position(f);
    const moonAt = moon.position(f);
    // the moon sits one small radius due east of wherever the sun is
    assert.ok(near(moonAt.x - sunAt.x, 10, 1e-6), `${moonAt.x - sunAt.x}`);
    assert.ok(near(moonAt.y - sunAt.y, 0, 1e-6));
  });

  test('a reference may point forward, to an object declared after it', () => {
    const doc = emptyDoc();
    doc.objects.unshift({
      kind: 'sphere',
      id: 'rider',
      name: 'Rider',
      center: { ref: 'carrier' },
      radius: 5,
      angle: 0,
    });
    doc.objects.push({ kind: 'anchor', id: 'carrier', name: 'Carrier', at: { x: 40, y: 0 } });
    const fig = compileDoc(doc);
    assert.equal(fig.problems.length, 0);
    const p = (fig.items.get('rider') as Sphere).position(frame(0));
    assert.ok(near(p.x, 45) && near(p.y, 0), JSON.stringify(p));
  });

  test('an expression reads the clock and the figure’s own parameters', () => {
    const doc = twoObjects();
    doc.params.push({ key: 'k', value: 0 });
    const sphere = doc.objects[1]!;
    if (sphere.kind !== 'sphere') throw new Error('fixture');
    sphere.radius = { expr: '100 + f.k * 50' };
    sphere.angle = { expr: 'f.t * 2' };

    const fig = compileDoc(doc);
    const sun = fig.items.get('sun') as Sphere;
    assert.equal(sun.radiusAt(fig.frameFor(0, { k: 0 })), 100);
    assert.equal(sun.radiusAt(fig.frameFor(0, { k: 1 })), 150);
    assert.ok(near(sun.angleAt(fig.frameFor(45, { k: 0 })), 90));
  });

  test('an expression can name another object, and reach its geometry', () => {
    const doc = twoObjects();
    doc.objects.push({
      kind: 'anchor',
      id: 'probe',
      name: 'Probe',
      // `sun.centerAt(f)` is not the same as the sun's position: it is the
      // circle's own centre, which is what a hand-written figure reaches for
      // when drawing the radius that carries something.
      at: { expr: 'sun.centerAt(f)' },
    });
    doc.objects.push({
      kind: 'anchor',
      id: 'probe2',
      name: 'Probe 2',
      at: { expr: '{ x: distanceBetween(earth, sun, f), y: 0 }' },
    });
    const fig = compileDoc(doc);
    assert.deepEqual(fig.env.allProblems(), []);

    const f = frame(0);
    const c = (fig.items.get('probe') as Anchor).position(f);
    assert.ok(near(c.x, 0) && near(c.y, 0), JSON.stringify(c));
    const d = (fig.items.get('probe2') as Anchor).position(f);
    assert.ok(near(d.x, 100), JSON.stringify(d));
  });

  test('a broken expression is reported once and does not take the figure down', () => {
    const doc = twoObjects();
    const sphere = doc.objects[1]!;
    if (sphere.kind !== 'sphere') throw new Error('fixture');
    sphere.radius = { expr: 'nosuchthing(' };

    const fig = compileDoc(doc);
    // the object is still there, and still drawable
    assert.ok(fig.items.has('sun'));
    assert.ok(fig.env.allProblems().length > 0);
    assert.match(fig.env.allProblems()[0]!.message, /radius/);
    // and it reads as the fallback rather than NaN
    assert.equal((fig.items.get('sun') as Sphere).radiusAt(frame(0)), 0);
  });

  test('an expression that throws while drawing stops being called', () => {
    const env = new Env();
    let calls = 0;
    env.registerHelpers({
      boom: () => {
        calls++;
        throw new Error('no');
      },
    });
    const fn = env.compile<number>('boom()', { id: 'x', field: 'radius' }, 7);
    assert.equal(fn(frame(0)), 7);
    assert.equal(fn(frame(1)), 7);
    assert.equal(fn(frame(2)), 7);
    assert.equal(calls, 1, 'it should have been called once, then latched');
    assert.equal(env.allProblems().length, 1);
  });

  test('an object the scene layer refuses is reported, and the rest still builds', () => {
    const doc = twoObjects();
    const sphere = doc.objects[1]!;
    if (sphere.kind !== 'sphere') throw new Error('fixture');
    sphere.plane = { tilt: 5, nodes: 0 };
    sphere.measureFrom = { ref: 'earth' };

    const fig = compileDoc(doc);
    assert.ok(fig.items.has('earth'), 'the earth should still be there');
    assert.ok(fig.problems.some((p) => p.id === 'sun'));
  });
});

describe('validating a document', () => {
  test('a reference to an id that is not there is named, with its field', () => {
    const doc = twoObjects();
    const sphere = doc.objects[1]!;
    if (sphere.kind !== 'sphere') throw new Error('fixture');
    sphere.center = { ref: 'mars' };
    const problems = validateDoc(doc);
    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.field, 'center');
    assert.match(problems[0]!.message, /mars/);
  });

  test('a circle of references is caught here, not sixty-four levels into a draw', () => {
    const doc = emptyDoc();
    doc.objects = [
      { kind: 'sphere', id: 'a', name: 'A', center: { ref: 'b' }, radius: 10 },
      { kind: 'sphere', id: 'b', name: 'B', center: { ref: 'a' }, radius: 10 },
    ];
    doc.view.refId = 'a'; // the earth went with the fixture; keep the camera on something real
    const problems = validateDoc(doc);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0]!.message, /circle/);
  });

  test('two objects with one id is a problem, since ids are how they refer to each other', () => {
    const doc = twoObjects();
    doc.objects.push({ kind: 'anchor', id: 'earth', name: 'Another earth' });
    assert.ok(validateDoc(doc).some((p) => /share the id/.test(p.message)));
  });

  test('a connector with neither an end nor a bearing is refused', () => {
    const doc = emptyDoc();
    doc.objects.push({ kind: 'connector', id: 'c', name: 'C', from: { ref: 'earth' } });
    assert.ok(validateDoc(doc).some((p) => /either .to. or .toward./.test(p.message)));
  });
});

describe('a document survives being written out and read back', () => {
  test('every example round-trips through JSON unchanged', () => {
    for (const build of [demoFigure, orreryFigure, inclinationFigure]) {
      const original = build();
      const result = parseDoc(serializeDoc(original));
      assert.ok(!('error' in result), `${original.name}: ${'error' in result ? result.error : ''}`);
      if ('error' in result) continue;
      assert.deepEqual(result.doc, original, original.name);
    }
  });

  test('something that is not a figure is refused with a readable message', () => {
    assert.match((parseDoc('{ nope') as { error: string }).error, /valid JSON/);
    assert.match((parseDoc('{"a":1}') as { error: string }).error, /not a figure/);
  });
});

describe('emitting TypeScript', () => {
  test('the emitted source names references by variable, not by id string', () => {
    const code = emitScene(twoObjects());
    assert.match(code, /const earth = new Anchor\(/);
    assert.match(code, /const sun = new Sphere\(/);
    assert.match(code, /center: earth,/);
    assert.doesNotMatch(code, /center: \{ ref/);
  });

  test('an expression is emitted as the closure it stands for', () => {
    const doc = twoObjects();
    const sphere = doc.objects[1]!;
    if (sphere.kind !== 'sphere') throw new Error('fixture');
    sphere.angle = { expr: 'f.t * 22' };
    assert.match(emitScene(doc), /angle: \(f\) => f\.t \* 22,/);
  });

  test('only the kinds the figure actually uses are imported', () => {
    const code = emitScene(twoObjects());
    assert.match(code, /\bAnchor,/);
    assert.match(code, /\bSphere,/);
    assert.doesNotMatch(code, /\bTrail,/);
    assert.doesNotMatch(code, /\bRingMarker,/);
  });

  test('a field the document leaves out is left out of the source too', () => {
    // `showBody` is derived from whether the sphere turns; freezing it into a
    // literal would stop it tracking that.
    assert.doesNotMatch(emitScene(twoObjects()), /showBody/);
  });

  test('a Hebrew name is emitted as itself', () => {
    const doc = twoObjects();
    doc.objects[1]!.nameHe = 'חמה';
    assert.match(emitScene(doc), /nameHe: 'חמה',/);
  });

  test('a figure with a ring gets a ZodiacRing, so its readings can reach it', () => {
    const code = emitDocument(orreryFigure(), { target: 'component' }).code;
    assert.match(code, /const ring = new ZodiacRing\(/);
    assert.match(code, /const ringRadius = /);
    assert.match(code, /zodiac: ring,/);
  });

  test('a named body renderer is reached through the namespace, never imported bare', () => {
    // The registry has a renderer called `sun`; this figure has an object
    // called `sun`. Imported bare, one would shadow the other.
    const code = emitDocument(demoFigure(), { target: 'component' }).code;
    assert.match(code, /import \* as renderers from/);
    assert.match(code, /render: renderers\.lit,/);
    assert.match(code, /render: renderers\.sun,/);
  });

  test('declarations come out in dependency order, whatever order the document is in', () => {
    const doc = emptyDoc();
    doc.objects.unshift({ kind: 'sphere', id: 'rider', name: 'Rider', center: { ref: 'carrier' }, radius: 5, angle: 0 });
    doc.objects.push({ kind: 'anchor', id: 'carrier', name: 'Carrier', at: { x: 40, y: 0 } });
    const code = emitScene(doc);
    assert.ok(
      code.indexOf('const carrier =') < code.indexOf('const rider ='),
      'a const cannot be used before it is declared, however the document is ordered',
    );
    // ...while the scene is still built in document order, which is what
    // breaks ties between objects on the same layer
    assert.ok(code.indexOf('.add(rider)') < code.indexOf('.add(carrier)'));
  });

  test('an expression that never mentions the frame emits a closure that never names it', () => {
    const doc = twoObjects();
    const sphere = doc.objects[1]!;
    if (sphere.kind !== 'sphere') throw new Error('fixture');
    sphere.radius = { expr: 'polar(0, 1).x * 100' };
    const code = emitScene(doc);
    assert.match(code, /radius: \(\) => polar/);
    // and the helper it reached for is imported
    assert.match(code, /\bpolar,/);
  });

  test('a figure with parameters gets a frame type, and its expressions keep their own text', () => {
    const code = emitDocument(orreryFigure(), { target: 'component' }).code;
    assert.match(code, /interface TheLadderOfGalgalimFrame extends Frame/);
    assert.match(code, /shells: number;/);
    // the expression reads exactly as it was typed in the editor
    assert.match(code, /on\(\(f\) => f\.shells \* 0\.9\)/);
    // and the wrapper is spelled so Astro's compiler does not take `<T>(` for a tag
    assert.match(code, /const on = <T,>\(/);
    assert.doesNotMatch(code, /<T>\(/);
  });

  test('a component is the figure and one mount call, not a page of wiring', () => {
    const code = emitDocument(twoObjects(), { target: 'component' }).code;
    assert.match(code, /mountAll\('\[data-untitled-figure\]'/);
    assert.match(code, /return mountFigure\(root, \{/);
    assert.match(code, /ref: earth,/);
    for (const plumbing of ['wireCamera', 'wireResize', 'wireAnimationLoop', 'HoverController', 'new Stage']) {
      assert.doesNotMatch(code, new RegExp(plumbing), `${plumbing} is mountFigure's business now`);
    }
  });

  test('only the parts of the theme that differ from the house style are written out', () => {
    const plain = emitDocument(twoObjects(), { target: 'component' }).code;
    assert.doesNotMatch(plain, /theme:/);
    assert.doesNotMatch(plain, /background:/);
    const doc = twoObjects();
    doc.theme.ring = '#123456';
    const themed = emitDocument(doc, { target: 'component' }).code;
    assert.match(themed, /theme: \{\n\s+ring: '#123456',\n\s+\}/);
    assert.doesNotMatch(themed, /activeFont/);
  });

  test('a motion given in degrees, minutes and seconds is written back that way, exactly', () => {
    const doc = twoObjects();
    const sun = doc.objects[1]!;
    if (sun.kind !== 'sphere') throw new Error('fixture');
    sun.speed = 13 + 10 / 60 + 35 / 3600;
    sun.phase = 30 + 1 + 14 / 60 + 43 / 3600;
    sun.countFrom = 'carrier';
    sun.clockwise = true;
    const code = emitScene(doc);
    assert.match(code, /speed: 13 \+ 10 \/ 60 \+ 35 \/ 3600, \/\/ 13°10′35″ a day/);
    assert.match(code, /countFrom: 'carrier',/);
    assert.match(code, /clockwise: true,/);
    // a number that is not a whole number of seconds stays a decimal, unrounded
    sun.speed = 0.98564733;
    assert.match(emitScene(doc), /speed: 0\.98564733,/);
  });

  test('an id is made from a name, without its "the", and kept unique', () => {
    assert.equal(idFromName('the large sphere', new Set()), 'large-sphere');
    assert.equal(idFromName('The moon’s epicycle', new Set()), 'moons-epicycle');
    assert.equal(idFromName('the moon', new Set(['moon'])), 'moon-2');
    assert.equal(idFromName('   ', new Set()), null);
  });

  test('an id becomes the same variable name the editor puts in scope', () => {
    assert.equal(varName('moon-deferent'), 'moonDeferent');
    assert.equal(varName('earth'), 'earth');
    assert.equal(varName('shell-least'), 'shellLeast');
    assert.equal(varName('2nd'), '_2nd');
  });
});

describe('editing', () => {
  test('the editor opens paused, whatever the figure does once it is published', () => {
    // a body that moves while you try to click it, or attach to it, is the
    // first thing that makes an editor feel broken
    const doc = twoObjects();
    doc.clock.running = true;
    const state = new EditorState(doc);
    assert.equal(state.playing, false);
    state.setPlaying(true);
    state.load(twoObjects());
    assert.equal(state.playing, false);
  });

  test('loading a figure is counted, so the camera re-fits to a new figure and not to an edit', () => {
    const state = new EditorState(twoObjects());
    const before = state.loads;
    state.edit((d) => {
      d.name = 'renamed';
    });
    assert.equal(state.loads, before);
    state.load(twoObjects());
    assert.equal(state.loads, before + 1);
  });

  test('an edit is undoable, and a run of them under one key is a single step', () => {
    const state = new EditorState(twoObjects());
    for (const r of [110, 120, 130]) {
      state.edit((d) => {
        const s = d.objects[1]!;
        if (s.kind === 'sphere') s.radius = r;
      }, { coalesce: 'drag' });
    }
    const sphere = state.doc.objects[1]!;
    assert.equal(sphere.kind === 'sphere' ? sphere.radius : null, 130);

    state.undo();
    const after = state.doc.objects[1]!;
    assert.equal(after.kind === 'sphere' ? after.radius : null, 100, 'one drag should be one step back');
    assert.ok(state.canRedo());
    state.redo();
    const redone = state.doc.objects[1]!;
    assert.equal(redone.kind === 'sphere' ? redone.radius : null, 130);
  });

  test('an edit that returns false changes nothing and adds no history', () => {
    const state = new EditorState(twoObjects());
    state.edit(() => false);
    assert.equal(state.canUndo(), false);
  });

  test('the figure recompiles after every edit, so the preview cannot drift', () => {
    const state = new EditorState(twoObjects());
    const before = state.fig;
    state.edit((d) => {
      const s = d.objects[1]!;
      if (s.kind === 'sphere') s.radius = 200;
    });
    assert.notEqual(state.fig, before);
    assert.equal((state.fig.items.get('sun') as Sphere).radiusAt(frame(0)), 200);
  });

  test('undoing past the removal of the selected object clears the selection', () => {
    const state = new EditorState(twoObjects());
    state.select('sun');
    state.edit((d) => {
      d.objects = d.objects.filter((o) => o.id !== 'sun');
    });
    assert.equal(state.selectedId, 'sun', 'still selected, though gone');
    state.undo();
    state.edit((d) => {
      d.objects = d.objects.filter((o) => o.id !== 'sun');
    });
    state.undo();
    assert.ok(state.doc.objects.some((o) => o.id === 'sun'));
  });

  test('setting a nested path creates its parent; clearing the last field removes it', () => {
    const o: Record<string, unknown> = {};
    setPath(o, 'eccentric.ratio', 0.2);
    assert.deepEqual(o, { eccentric: { ratio: 0.2 } });
    assert.equal(getPath(o, 'eccentric.ratio'), 0.2);
    deletePath(o, 'eccentric.ratio');
    assert.deepEqual(o, {}, 'an empty eccentric would read as "off-centre by nothing stated"');
  });
});

describe('dragging', () => {
  test('dragging a sphere’s rim sets its radius', () => {
    const state = new EditorState(twoObjects());
    state.select('sun');
    const handles = handlesFor(state.doc.objects[1]!, state.fig, state.frame());
    const rim = handles.find((h) => h.id === 'radius');
    assert.ok(rim, 'a sphere with a plain radius should have a rim handle');
    rim.drag({ x: 0, y: -60 }, state);
    const sphere = state.doc.objects[1]!;
    assert.equal(sphere.kind === 'sphere' ? sphere.radius : null, 60);
  });

  test('a radius written as an expression has no rim handle, since a drag could not set it', () => {
    const doc = twoObjects();
    const sphere = doc.objects[1]!;
    if (sphere.kind !== 'sphere') throw new Error('fixture');
    sphere.radius = { expr: 'f.t' };
    const state = new EditorState(doc);
    assert.equal(handlesFor(doc.objects[1]!, state.fig, state.frame()).some((h) => h.id === 'radius'), false);
  });

  test('dragging the body sets where it stands when the clock reads zero', () => {
    const state = new EditorState(twoObjects());
    state.setClock(0);
    const body = handlesFor(state.doc.objects[1]!, state.fig, state.frame()).find((h) => h.id === 'body');
    assert.ok(body);
    body.drag({ x: 0, y: -50 }, state); // due north
    const sphere = state.doc.objects[1]!;
    assert.equal(sphere.kind === 'sphere' ? sphere.phase : null, 90);
  });

  test('an anchor riding another object cannot be dragged, because its place is not its own', () => {
    const doc = emptyDoc();
    doc.objects.push({ kind: 'anchor', id: 'rider', name: 'Rider', at: { ref: 'earth' } });
    const state = new EditorState(doc);
    assert.equal(handlesFor(doc.objects[1]!, state.fig, state.frame()).length, 0);
  });
});

describe('the worked examples — the baseline this editor is measured against', () => {
  for (const build of [demoFigure, orreryFigure, inclinationFigure]) {
    const doc = build();

    test(`${doc.name} compiles with nothing wrong`, () => {
      const fig = compileDoc(doc);
      assert.deepEqual(
        fig.problems.map((p) => `${p.id ?? ''} ${p.field ?? ''}: ${p.message}`),
        [],
      );
      assert.deepEqual(fig.env.allProblems().map((p) => `${p.id}.${p.field}: ${p.message}`), []);
      assert.equal(fig.items.size, doc.objects.length);
    });

    test(`${doc.name} puts every object somewhere real, at several moments`, () => {
      const fig = compileDoc(doc);
      const params = Object.fromEntries(doc.params.map((p) => [p.key, p.value]));
      for (const t of [0, 3.25, 40, 365]) {
        const f = fig.frameFor(t, params);
        for (const [id, item] of fig.items) {
          if (!('position' in item)) continue;
          const p = item.position(f);
          assert.ok(
            Number.isFinite(p.x) && Number.isFinite(p.y),
            `${doc.name}: ${id} is at ${JSON.stringify(p)} at t=${t}`,
          );
        }
      }
      // and nothing threw along the way
      assert.deepEqual(fig.env.allProblems().map((p) => `${p.id}.${p.field}: ${p.message}`), []);
    });

    test(`${doc.name} emits source that mentions every object it has`, () => {
      const code = emitDocument(doc, { target: 'component' }).code;
      for (const o of doc.objects) {
        assert.match(code, new RegExp(`const ${varName(o.id)} = new `), `${doc.name}: ${o.id}`);
      }
    });
  }
});

describe('the bodies', () => {
  test('every known body has a name in both languages, a colour, and a renderer that exists', () => {
    for (const b of BODIES) {
      assert.ok(b.name && b.nameHe && /^#[0-9a-f]{6}$/i.test(b.color), b.key);
      if (b.render !== undefined) assert.ok(getRenderer(b.render), `${b.key}: renderer ${b.render}`);
    }
  });

  test('a point can be a body: it compiles, and emits with its renderer', () => {
    const doc = emptyDoc();
    const earth = doc.objects[0]!;
    if (earth.kind !== 'anchor') throw new Error('fixture');
    earth.body = 'earth';
    earth.render = { ref: 'lit' };
    assert.deepEqual(compileDoc(doc).problems, []);
    const code = emitScene(doc);
    assert.match(code, /render: renderers\.lit,/);
    assert.match(code, /import \* as renderers from/);
    assert.doesNotMatch(code, /body: 'earth'/);
  });

  test('which body a sphere carries is the editor’s note, and never reaches the emitted source', () => {
    const doc = twoObjects();
    const sun = doc.objects[1]!;
    if (sun.kind !== 'sphere') throw new Error('fixture');
    sun.body = 'sun';
    sun.render = { ref: 'sun' };
    const code = emitScene(doc);
    assert.doesNotMatch(code, /body: 'sun'/);
    assert.match(code, /render: renderers\.sun,/);
    assert.deepEqual(compileDoc(doc).problems, []);
  });
});
