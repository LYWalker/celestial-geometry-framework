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

There are two entry points:

```ts
// the geometry/camera/annotate/labels/hover primitives, AND the scene layer
// (Sphere, Anchor, Angle, Connector, Trail, Scene, Stage) — re-exported
// from one place so most consumers only need this import
import { Scene, Stage, Sphere, Anchor, wireCamera } from 'celestial-geometry-framework';

// just the scene layer, if you want the subpath explicit
import { Scene, Stage, Sphere, Anchor, wireCamera } from 'celestial-geometry-framework/scene';
```

The primitives (`geometry.ts`, `camera.ts`, `annotate.ts`, `labels.ts`,
`hover.ts`) are also usable on their own, without the scene layer at all —
that's how `components/Orrery.astro` is built, by hand, as the benchmark the
scene layer is measured against (see below).

## Quickstart

```ts
import { Anchor, Sphere, Scene, Stage, HoverController, wireCamera, frame } from 'celestial-geometry-framework';

const earth = new Anchor({ id: 'earth', name: 'The earth', marker: 'cross' });
const sunShell = new Sphere({
  id: 'sun', name: 'The sun', nameHe: 'חמה', color: '#f0c14b',
  center: earth, radius: 120, eccentric: { ratio: 0.09, direction: 65 },
  speed: 360 / 365.25,
});
const scene = new Scene().add(earth).add(sunShell);

const stage = new Stage({ canvas, background: { ... }, zodiac: { ... } });
stage.resize({ fitRadius: 140 });
const hover = new HoverController({ root: tipEl, text: tipTextEl, sub: tipSubEl });
let pointer: Vec | null = null;
const cleanup = wireCamera({
  canvas, camera: stage.camera,
  minZoom: () => stage.fit * 0.4, maxZoom: () => stage.fit * 40,
  onChange: draw, onHover: (p) => { pointer = p; draw(); },
});

function draw() {
  const f = frame(days); // or frame(days, { shellT, frameT }) for a diagram with UI-driven transitions
  stage.render({ scene, f, ref: earth, theme, hover, pointer });
}
```

No step in defining `sunShell` did any trigonometry — radius, how far
off-centre, and how fast it turns are the only numbers given, and
`sunShell.position(f)` (what actually gets drawn and hovered) is derived.

For a complete, running version of this pattern — including a fading
`Trail`, a `measureFrom` epicycle, and a custom lit-body renderer — see
`components/CanvasDiagramDemo.astro`, the worked example this kit is proved
against.

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
