# celestial-geometry-framework

A small TypeScript kit for interactive celestial/geometric canvas figures in
the Kiddush HaChodesh / Yesodei haTorah style: a camera you can pan and zoom,
angle constructions (sweep an arc, mark it), a collision-avoiding label
layout engine, and "hover a line and it explains itself." On top of those
primitives sits a declarative scene layer — spheres, anchors, angles,
connectors and trails, each with a name and a description — so a new figure
is built by *declaring what it is*, not by deriving polar coordinates by hand.

## Install / import

This package ships TypeScript source, not a compiled `dist/` — `exports` in
`package.json` points straight at the `.ts` files. That's deliberate: you're
expected to bundle it (Vite, esbuild, Rollup, whatever your app already
uses) rather than consume prebuilt JS, so there's no build step to keep in
sync and no published artifact to go stale. If you need a build step of your
own for a non-bundled environment, compile the source with your own
`tsconfig.json` (see the one at the repo root for the settings this codebase
itself expects: strict, `target ES2022`, `moduleResolution bundler`).

There are three entry points:

```ts
// the geometry/camera/annotate/labels/hover primitives, AND the scene layer
// (Sphere, Anchor, Angle, Connector, Trail, Scene, Stage) — re-exported
// from one place so most consumers only need this import
import { Scene, Stage, Sphere, Anchor, wireCamera } from 'celestial-geometry-framework';

// just the scene layer, if you want the subpath explicit
import { Scene, Stage, Sphere, Anchor, wireCamera } from 'celestial-geometry-framework/scene';

// the editor: build a figure by placing and adjusting it, then emit it as
// ordinary TypeScript. See "The editor" below.
import { mountEditor } from 'celestial-geometry-framework/editor';
```

The primitives (`geometry.ts`, `camera.ts`, `annotate.ts`, `labels.ts`,
`hover.ts`) are also usable on their own, without the scene layer at all —
that's how `components/Orrery.astro` is built, by hand, as the benchmark the
scene layer is measured against (see below).

## Quickstart

A whole figure is its objects and one call:

```astro
<figure data-sun-figure>
  <figcaption>The sun's eccentric circle.</figcaption>
</figure>

<script>
  import { Anchor, MAZALOT, Scene, Sphere, mountAll, mountFigure } from 'celestial-geometry-framework';

  mountAll('[data-sun-figure]', (root) => {
    const earth = new Anchor({ id: 'earth', name: 'the earth', marker: 'crosshair' });
    const sun = new Sphere({
      id: 'sun', name: 'the sun', nameHe: 'חמה', color: '#e0b45c',
      center: earth, radius: 100,
      eccentric: { ratio: 2.5 / 60, direction: 60 + 26 + 45 / 60 }, // apogee 26°45′ Gemini
      speed: 59 / 60 + 8 / 3600, // 0°59′8″ a day
    });
    return mountFigure(root, {
      scene: new Scene().add(earth).add(sun),
      ref: earth,
      zodiac: { segments: MAZALOT },
      label: "The sun's eccentric circle",
    });
  });
</script>
```

No step in defining `sun` did any trigonometry — radius, how far off-centre,
and how fast it turns are the only numbers given, and `sun.position(f)` (what
actually gets drawn and hovered) is derived.

`mountFigure` is everything around the objects: the canvas and its hover
tooltip, pan/zoom/keyboard camera, a fit that takes in the scene and its ring,
the clock, a slider or toggle per `params` entry, the screen-reader list, and
teardown. Only what differs from the house style needs saying — `theme` is a
partial over `DEFAULT_THEME`, `background` defaults to `DEFAULT_BACKGROUND`.
It returns a handle (`stage`, `hover`, `frame()`, `set(key, v)`, `play()`,
`pause()`, `seek(t)`, `draw()`, `destroy()`) for a figure that needs to reach
past it. `mountAll(selector, init)` finds every instance on the page, now and
after each Astro navigation, and tears each down when its page goes.

A figure that needs more control than that can still assemble the pieces by
hand — `Stage`, `HoverController`, `wireCamera`, `wireResize`,
`wireAnimationLoop` — which is how the figures in `components/` predating
`mountFigure` are written, and what it does inside.

### Stating motions the way the text does

A sphere's `speed` is degrees per unit of the clock and `phase` its bearing at
`t = 0`, anticlockwise from east. Two options let a source's numbers go in as
it states them, with no conversion:

- **`clockwise: true`** — `phase`/`speed` (or `angle`) are counted clockwise.
  The moon runs its small sphere against the large one (KH 14:3); its course is
  still a positive 13°3′54″ a day.
- **`countFrom: 'carrier'`** — counted from the line the sphere it rides is
  carrying it along (its carrier's `angleAt`), not from east. That is how the
  course is reckoned: from the small sphere's far point.

```ts
const large = new Sphere({ id: 'large', name: 'the large sphere', center: earth, radius: 100,
  speed: 13 + 10 / 60 + 35 / 3600, phase: 30 + 1 + 14 / 60 + 43 / 3600 });
const moon = new Sphere({ id: 'moon', name: 'the moon', center: large, radius: 100 / 9,
  speed: 13 + 3 / 60 + 54 / 3600, phase: 84 + 28 / 60 + 42 / 3600,
  countFrom: 'carrier', clockwise: true });
```

## Core concepts

### `Frame`

A moment in the diagram: `readonly t: number` (the clock) plus whatever
other named, numeric UI state the diagram's values read from — transition
amounts, toggles, a distance-scale mix. Build a Frame with `frame(t)` or
`frame(t, { shellT, frameT })`.

**Build exactly one `Frame` per draw call and thread that same object
through everything.** `Sphere`, `Angle` and `Connector` all memoise their
per-frame work (a centre, a radius, a swept angle) keyed on the Frame
*object's identity*, not its contents — a fresh `{ t, ...extra }` literal
built partway through a draw call silently defeats every memo downstream of
it, recomputing work that should have been shared and, worse, leaving stale
memos primed against the wrong object for whoever reads them next. There is
deliberately no runtime check for this; it would cost every correct call to
protect against the mistaken one.

A `Scalar` that reads a Frame key you didn't put in your Frame doesn't error
either — it reads as `undefined`, propagates as `NaN`, and the object it
belongs to quietly stops appearing on screen. `Scene.draw()` guards against
that specific failure (it checks for non-finite positions and warns once per
object id) but a typo'd key is still a typo'd key; there's no compile-time
check for it (see `Frame`'s own index signature).

### `Scalar` / `PointLike` / `DirectionLike`

The three ideas every scene object is built from, so "centre this sphere on
that one" or "sweep this angle to wherever the moon is" needs no
case-by-case plumbing:

- **`Scalar`** — `number | ((f: Frame) => number)`. A radius, an
  eccentricity, an opacity: a fixed value, or a function of the frame.
- **`PointLike`** — `Vec | Positioned | ((f: Frame) => Vec)`. A fixed point,
  another object (read its current `position(f)`), or a function.
- **`DirectionLike`** — `number | ((f: Frame) => number) | Positioned`. A
  fixed bearing, a function, or "point toward wherever this other object
  currently is." Degrees run anticlockwise from due east (see Coordinate
  convention, below).

### The object model

- **`Sphere`** — a circular shell that covers every construction this kit's
  figures need: a plain nested shell (`showBody: false`), a body on a
  circular path (`speed` or `angle`), an eccentric circle (`eccentric`), an
  epicycle (a Sphere whose `center` *is* another Sphere), and an angle
  measured from a point that isn't the circle's own centre (`measureFrom` —
  the ray/circle intersection the Rambam's moon needs, derived rather than
  hand-solved).
- **`Anchor`** — a fixed reference point with a name ("the earth"), for
  other objects to centre on or point toward.
- **`Angle`** — an annotated arc swept between two directions from a
  vertex, with an arrowhead and, optionally, its numeric value.
- **`Connector`** — a line between two points that may themselves be
  moving, or a sightline toward a direction with no real endpoint
  (`toward`/`length` instead of `to`).
- **`Trail`** — a rolling window of a target's past positions, redrawn every
  frame in *today's* reference frame, so switching which point the camera
  holds still bends the trail into its new shape rather than requiring a
  redraw from scratch.

### `Scene` vs `Stage`

- **`Scene`** is *what the diagram is*: `add()` your objects once, and
  `draw()` every frame with a `Frame` and a camera. It handles draw order
  (`layer`), registers everything with a `HoverController`, and hands back
  the `Label[]` for `drawLabels()` to lay out.
- **`Stage`** is the chrome around it: canvas backing-store sizing, the
  starfield, an optional segmented ring at the frame's edge (a zodiac, or
  anything else divided into even arcs), and `render()` — the one call a
  straightforward figure needs per frame (background, zodiac, the Scene,
  the hover tooltip, labels, the hover highlight, in the order they have to
  happen in).
- **`ZodiacRing`** is that ring as an object, and it sizes itself: give it
  `segments` (and `padding`, world px of clearance, default 28) and it sits
  just outside the furthest thing `Scene.extent()` finds, instead of a
  radius the figure has to keep in step with its own geometry. Declare it
  before the scene and its `inner`/`outer` are ordinary Scalars, so a dial
  line reaches exactly to it — `length: ring.outer` — and so does
  `resize({ fitRadius: ring.outer(f) + 8 })`. A line drawn to the ring
  doesn't push the ring out. Pass `radius` to place it by hand instead.
  For a ring that should be a fixed backdrop rather than something that
  follows the picture around, `warm(views).freeze()` with `fit: 'grow'`
  measures every view the figure can show, keeps the largest and stops —
  the centre still travels, only the size is fixed. Warm it with moments
  the figure can really be in: sweeping a Frame's amounts independently
  invents views it never shows, and freezes the ring to one of those.
- **`wireCamera`** wires a canvas's wheel/pointer events to the pan/zoom
  math in `camera.ts`: wheel and pinch zoom on the point under the
  cursor/fingers, one-finger drag pans, a drag that never really moved
  resolves as a click, and the keyboard pans/zooms/resets once the figure
  has focus. What a click *does* stays the caller's, via `onClick`; what
  `0` resets to is `onReset` (default: the view the figure opened with).
- **`wireResize`** keeps a figure sized to its element, and handles the case
  that's easy to get wrong: an element with no layout yet (a hidden tab, a
  closed `<details>`) can't be measured, and is simply resized again when it
  gains a size rather than leaving a permanently blank canvas.
- **`wireAnimationLoop`** runs the clock, pausing itself off-screen and
  under `prefers-reduced-motion` — without stopping the figure responding
  to interaction.

### The state around a figure

- **`Transitions`** owns the named, eased amounts a `Frame` is built from —
  "the view is sliding from heliocentric to geocentric," "the shells are
  fading in." A figure sets targets (`view.set({ shellT: 1 })`), advances
  them by the frame's elapsed seconds, and asks for a Frame
  (`view.frame(days)`); the framerate-independent approach, the settling,
  and the frame assembly are all here rather than in each figure's tick().
- **`Selection`** is "click a body to follow it": what's selected, what a
  click does to that, and which point the camera should hold still —
  `stage.render({ ref: following.ref() })`. `selectable` limits what may be
  followed at all.
- **`describeScene`/`describeSceneInto`** derive a figure's text alternative
  from the objects themselves — every named object's name and description,
  the same data the hover tooltip shows — so the accessible version of a
  figure can't drift from what's actually declared.

## The worked example

`components/CanvasDiagramDemo.astro` is the proof of the scene-layer API: it
reproduces, in miniature, the constructions `Orrery.astro` built by hand —
nested shells, the sun's eccentric circle, the moon's epicycle measured from
the earth, a fading trail, a custom lit-body renderer — with no
trigonometry anywhere in its script. Start there when building a new figure.

## The editor

`canvas-diagram/editor/` is an authoring tool for these figures: draw them with
tools, set their values exactly, then take the result away as ordinary
TypeScript.

```ts
import { mountEditor, EXAMPLES } from 'celestial-geometry-framework/editor';

mountEditor(document.querySelector('#editor')!, {
  examples: EXAMPLES,
  // names this project's own figures are written in terms of; expressions can
  // then say `rambam.rambamMoon(f.t).true`, and emit as exactly that call
  helpers: { rambam },
});
```

`components/DiagramEditor.astro` is that call plus an element to put it in, and
`/dev/diagram-editor` is the page it runs on in this repo.

### Drawing: every press attaches to something

The toolbar holds the tools (keys in brackets): Sphere (S), Line (L), Angle
(A), Point (P), Trail (T), Reading (R), and a switch for the mazalot ring.

A tool press only ever lands *on* something — a body or named point, a
sphere's own centre, or a whole degree of the mazalot ring — never on empty
space, since a point in empty space is a coordinate nobody can state. What a
press would attach to is shown before it happens (a halo and its name), and
what it attaches to becomes a reference, so the figure holds together as
things move:

- **Sphere** — press on what it is centred on, drag (or click) out the radius.
  On a body it is an epicycle. The radius snaps through bodies and to spheres
  sharing its centre; otherwise to a whole world px.
- **Line** — from an object to another object; or to the ring, for a sightline
  toward that longitude reaching out to it.
- **Angle** — the vertex, then two arms: objects, or longitudes on the ring.
- **Point · Trail · Reading** — one click on what they are of.

A sphere's or a point's panel opens with **Its body** — what rides the
sphere, or what the point is: none (a bare shell; a point's plain marker), one
of the known bodies (the sun, the moon, Mercury … Saturn, the
earth), which brings its name in both languages, its colour and its icon, or a
custom body, named by hand and drawn with an icon picked from previews of each
renderer. Only the look comes from the choice; how it moves is set exactly
below it. **New…** starts a figure about the earth or about the sun. The
known bodies are `editor/bodies.ts`.

The selected object's panel opens with **Build on it** — an epicycle on it, a
line from the earth, its trail, its reading on the ring — and every reference
field has a **Pick** button: press it, click the target.

### Values, exactly — in the source's own terms

Drawing gets a figure roughly right; the panel makes it exact. Radius, motion,
starting point, eccentricity and every bearing accept what the sources write,
and say back what they understood in every other form:

| field | type any of | reads back as |
| --- | --- | --- |
| motion | `13°10′35″` · `13 10 35` · `13;10,35` · `136°28′20″ per 10000 days` · `27.32 days` · `0.9856` | `13°10′35″ a day · 13.176389°/day · once round in 27.322 days` |
| bearing / start | `26°45′8″ Gemini` · `Gemini 26;45,8` · `תאומים 26 45` · `86.75` | `26°45′8″ Gemini · 86°45′8″ from east` |
| eccentricity | `2;30/60` · `10;19 / 49;41` · `1/9` · `4%` · `0.0417` | `2;30 parts of 60 · 4.167% of its radius` |
| length | `100` · `100/9` | |

Beside a motion, ↺/↻ sets which way it turns; under More options, "Its motion is
counted from: carrier" states an epicycle's motion as the text does. Values
commit on Enter or on leaving the field. Handle drags land on whole numbers
(Shift for tenths), and the emitted source writes a value given in degrees,
minutes and seconds back that way — `speed: 13 + 10 / 60 + 35 / 3600, // 13°10′35″ a day`
— exactly, not rounded.

### It is three layers, and only the top one is a UI

- **`doc.ts` — the document.** The serialisable form of a figure: plain JSON, no
  closures, no object identity. Every field the scene layer types as "a number
  *or* a function of the frame" is typed here as "a number *or* a source
  string" (`{ expr: 'f.t * 22' }`), and every reference between objects is an
  `id` rather than an object. That is the whole difference.
- **`compile.ts` / `emit.ts` — the round trip.** A document compiles to live
  `Scene` objects, and emits as the source a hand-written figure would have
  been. Neither is the editor's private business: a build step can compile
  documents, and a script can emit them.
- **`editor.ts` — the UI** over the two.

### What makes the preview trustworthy

Every edit replaces the whole document, recompiles the whole figure, and
redraws. There is no incremental update path anywhere, which is deliberate: the
hardest bug in a tool like this is the preview quietly disagreeing with the
document because one field had an update path and another didn't. If the only
path is "recompile", there is nothing to be inconsistent with. It also makes
undo a copy per edit rather than a set of inverse operations to get subtly
wrong.

The same reasoning runs the other way for the emitter. `npm run emit-check`
emits every worked example both ways and compiles the result under this repo's
own `tsconfig.json` — strict, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `noUnusedLocals` and all. A figure that leaves the
editor is source, and source that does not compile is not an export.

### Expressions

Anything the scene layer lets vary with the frame gets an *ƒx* toggle in the
panel, and becomes a snippet evaluated with the frame in scope as `f`. In scope
besides `f`: the kit's own geometry (`polar`, `norm360`, `distanceBetween`, …),
three blending helpers (`lerp`, `ease`, `wrap180`), every object in the figure
under the same name the emitted source will give it (`moonDeferent.centerAt(f)`
works, and means what it looks like), the ring (`ringRadius(f)`,
`ringOuter(f)`), and whatever the host registered through `helpers`.

Evaluating source text is a real decision, so it is worth being plain about
what it is and is not. This is an authoring tool: the text being evaluated is
the text its author typed a keystroke earlier, in their own browser, and the
emitted file contains the same text compiled by their own build. There is no
trust boundary between the typist and the evaluator. There *is* a fragility
boundary, and that is what `expr.ts` is built around — compile once per source
string, catch, report, latch the failure, and keep drawing, so a half-typed
expression never takes the figure off the screen.

### Parameters

A figure's expressions can read named amounts besides the clock — `f.shells`,
`f.corrected`. Declaring one in the Figure panel is the whole of what it takes:
it gets a slider here, a slider in the emitted component, and a key in the
emitted `frame()` call. This is how a figure gets a mode it can fade between.

Because `Frame` carries those through an index signature, `f.shells` reads as
`number | undefined` under `noUncheckedIndexedAccess`. The kit's hand-written
figures answer that with a cast at each use; the emitter declares the figure's
own frame interface and one wrapper, so the expression in the emitted file is
character-for-character the expression in the document — which is what lets one
be read against the other, and pasted back.

### The baseline

`canvas-diagram/editor/examples/` holds three figures as documents, and they
are the tool's own measure rather than decoration. Between them they use every
field of every kind the scene layer has: nested and eccentric circles, an
epicycle, an angle measured from somewhere that is not a circle's own centre, a
tilted plane, trails, sightlines of both kinds, readings on the ring sighted
from two different points, named body renderers, a self-sizing ring with
constellations, and parameters that fade one model into another. `npm test`
compiles each of them, checks that nothing goes wrong and that every object
lands somewhere real at four different moments; `npm run emit-check` compiles
what they emit. If something in the kit cannot be said in a document, that is
the gap those examples exist to find.

## `Orrery.astro` vs `OrreryFw.astro`: a deliberate benchmark

`components/Orrery.astro` (hand-built, ~3600 lines) and
`components/OrreryFw.astro` (framework-built on the scene layer, ~2800
lines) are **not** an abandoned duplicate — they're a deliberate side-by-side
benchmark, viewable together at `/dev/orrery-compare`. Same figure, same
interactions, same visual result; one written directly against
`geometry.ts`/`camera.ts`/`annotate.ts`/`hover.ts`/`labels.ts`, the other
declared against `Scene`/`Stage`/`Sphere`/`Angle`/`Connector`/`Trail`. The
framework version is about 22% shorter and contains no trigonometry at all —
every `Math.cos`/`Math.sin` in `Orrery.astro` corresponds to a `radius`,
`center`, `eccentric` or `angle` declaration in `OrreryFw.astro` that the
scene layer resolves instead. Keep both: `Orrery.astro` is also useful on
its own, as the reference for what the primitive layer looks like without
the scene layer on top of it.

## Coordinate convention

Degrees run **anticlockwise from due east**: 0° is right (+x), 90° is up.
Canvas `y` is down, the opposite sense — `geometry.polar()` is where that
flip happens (`y: -r * sin(lon)`), and `geometry.lonOf()` is its inverse.
Every angle in this kit (a `Sphere`'s `angle`/`phase`, an `Angle`'s
`from`/`to`, a `Connector`'s `toward`) is stated in this convention, so a
bearing computed one way and consumed another always agrees.

## Memoisation and `cfg` mutation

`Sphere`, `Angle` and `Connector` each memoise their per-frame work, keyed
on `Frame` object identity (see `Frame`, above). Their `cfg` is public and
documented as author-writable — `Scene` itself ships `invalidateOrder()` for
exactly this reason, so that mutating an already-added item's `cfg.layer`
takes effect — but a memoising object's cache doesn't notice a `cfg` change
*within* the same frame on its own. If you mutate `cfg` after that object
has already been read once this frame (a UI control's change handler firing
mid-draw, say), call `invalidate()` on it afterward, or wait for the next
`Frame` object.

## License

MIT — see [LICENSE](./LICENSE).
