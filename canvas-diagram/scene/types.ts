/**
 * The shared vocabulary for the declarative scene layer: something with a
 * position at a moment ("Positioned"), a value that may be fixed or a
 * function of that moment ("Scalar"), and a point that may be fixed,
 * computed, or borrowed from another object's current position
 * ("PointLike"). Sphere, Anchor, Angle and Connector are all built from
 * these three ideas so that "centre this sphere on that one" or "sweep this
 * angle to wherever the moon is" needs no case-by-case plumbing —
 * resolvePoint() and resolveScalar() are the only two functions that ever
 * have to know the difference.
 *
 * "A moment" is a Frame, not a bare number. A diagram is almost never driven
 * by its clock alone — Orrery.astro's own figure needs a clock (`days`) *and*
 * three independent 0..1 transition amounts (`shellT`, `frameT`, `scaleT`)
 * that a UI control sets, and every one of its radii, eccentricities and
 * alphas is a function of some mix of those. A Scalar that only accepted
 * `(t: number) => number` would leave "read the current UI state" as an
 * undocumented, uncacheable trick (closing over a mutable outer variable).
 * A Frame makes it a first-class, named input: a diagram declares what
 * belongs in its frame beyond the clock, builds one Frame object per draw
 * call, and every Scalar in the diagram reads off it by name — `(f) =>
 * f.shellT`. Passing the *same* Frame object through a whole draw call is
 * also what lets an object memoise its own position for that frame (see
 * Sphere) instead of re-walking a chain of parents on every read.
 */

import { type Vec, dot, lonOf, polar, sub, unit } from '../geometry.js';
import type { Camera } from '../camera.js';
import type { Face } from '../labels.js';

export interface Frame {
  /** the diagram's clock — whatever unit its speeds are stated in */
  readonly t: number;
  /** any other named, numeric UI state a diagram's Scalars read from —
   * transition amounts, toggles (0/1), a distance-scale mix, and so on */
  readonly [key: string]: number;
}

/**
 * Build a Frame: `frame(days)`, or `frame(days, { shellT, frameT })`. Build
 * *one* per draw call and thread that same object through everything — a
 * fresh Frame per object silently defeats every memo in the scene (Sphere's
 * `position()` cache, Angle's) since they key on Frame *identity*, not on
 * its contents. There is deliberately no runtime check for this; it would
 * cost every legitimate call to pay for the mistaken one. A `Scalar` that
 * reads a key you didn't put in your Frame doesn't error either — it reads
 * as `undefined`, propagates as `NaN`, and the object it belongs to quietly
 * stops appearing on screen; Scene.draw() guards against that specific
 * failure (see its NaN check) but a typo'd key is still a typo'd key.
 */
export function frame(t: number, extra?: Record<string, number>): Frame {
  return extra ? { t, ...extra } : { t };
}

export interface Positioned {
  /** where this object is, in world px, at this moment */
  position(f: Frame): Vec;
}

export type Scalar = number | ((f: Frame) => number);

/** A boolean that may depend on the frame — a UI layer toggle, not just a
 * value fixed at construction (`SphereConfig.markCenter` is the motivating
 * case: whether to show the centre mark should follow an "off-centre orbit"
 * switch, not be locked in when the Sphere is built). */
export type BoolLike = boolean | ((f: Frame) => boolean);

export function resolveBool(b: BoolLike | undefined, f: Frame): boolean {
  return typeof b === 'function' ? b(f) : (b ?? false);
}

export type PointLike = Vec | Positioned | ((f: Frame) => Vec);

export const ORIGIN: Readonly<Vec> = Object.freeze({ x: 0, y: 0 });

export function resolveScalar(s: Scalar, f: Frame): number {
  return typeof s === 'function' ? s(f) : s;
}

/** How deep a chain of `center`/`at`/PointLike references may nest before
 * resolvePoint() gives up and throws, rather than recursing forever. No
 * legitimate diagram in this kit's style nests anywhere near this deep (the
 * Rambam figures top out around 3–4: earth → large circle → small circle →
 * carried body) — this exists purely to catch the easy authoring mistake of
 * a cycle (`a.cfg.center = b; b.cfg.center = a`), which without a guard
 * recurses through position()/centerAt() until the JS stack overflows with
 * a generic, unhelpful `RangeError: Maximum call stack size exceeded`. */
const MAX_RESOLUTION_DEPTH = 64;
let resolutionDepth = 0;

export function resolvePoint(p: PointLike | undefined, f: Frame): Vec {
  if (p === undefined) return { x: 0, y: 0 };
  if (typeof p === 'function') return p(f);
  if ('position' in p) {
    if (resolutionDepth >= MAX_RESOLUTION_DEPTH) {
      // Not necessarily this object's own fault — it's just the one that
      // pushed a chain already MAX_RESOLUTION_DEPTH deep over the edge —
      // but its id is still the most useful thing to name, since it's the
      // object nearest wherever a `center`/`at` chain (accidentally) loops.
      const maybeId = (p as { id?: unknown }).id;
      const id = typeof maybeId === 'string' ? maybeId : '(no id)';
      throw new Error(
        `canvas-diagram: PointLike resolution nested ${MAX_RESOLUTION_DEPTH} levels deep while resolving "${id}" — ` +
          `this almost always means a cyclic reference (e.g. \`a.cfg.center = b; b.cfg.center = a\`), not a ` +
          `legitimately deep scene. Check the chain of \`center\`/\`at\`/PointLike fields leading to "${id}".`,
      );
    }
    resolutionDepth++;
    try {
      return p.position(f);
    } finally {
      resolutionDepth--;
    }
  }
  return p;
}

/** A direction (degrees) that may be a fixed bearing, a function of the
 * frame, or "point toward wherever this other object currently is, seen
 * from `from`". Degrees run anticlockwise from due east (+x) — 0 is right,
 * 90 is up — the same compass convention geometry.polar() uses, so a
 * bearing computed one way and consumed the other always agrees. */
export type DirectionLike = number | ((f: Frame) => number) | Positioned;

export function resolveDirection(d: DirectionLike, from: Vec, f: Frame): number {
  if (typeof d === 'number') return d;
  if (typeof d === 'function') return d(f);
  return lonOf(sub(d.position(f), from));
}

/** Resolve a `Meta.gloss`-shaped field — a fixed line, or one that states a
 * live figure ("the true sun · Leo 14° 02'"). */
export function resolveText(
  g: string | ((f: Frame) => string) | undefined,
  f: Frame,
): string | undefined {
  return typeof g === 'function' ? g(f) : g;
}

/** Resolve a `Meta.labelDir`-shaped field — a fixed direction or one that
 * follows the frame — falling back to `fallback` when it isn't set. Always
 * returns a unit vector, so an author can hand over any convenient vector
 * (a raw `p - c`) without normalising it themselves. */
export function resolveLabelDir(
  d: Vec | ((f: Frame) => Vec) | undefined,
  f: Frame,
  fallback: Vec,
): Vec {
  const v = d === undefined ? fallback : typeof d === 'function' ? d(f) : d;
  return Math.hypot(v.x, v.y) > 1e-9 ? unit(v) : fallback;
}

/** The distance between two points (fixed, computed, or another object's
 * position) at this moment — the thing every reading like "0.98 × R" in a
 * readout panel is built from, without an author reaching for Math.hypot. */
export function distanceBetween(a: PointLike, b: PointLike, f: Frame): number {
  const pa = resolvePoint(a, f);
  const pb = resolvePoint(b, f);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

/** The bearing (degrees) from `a` to `b` at this moment. */
export function bearingFrom(a: PointLike, b: PointLike, f: Frame): number {
  const pa = resolvePoint(a, f);
  const pb = resolvePoint(b, f);
  return lonOf(sub(pb, pa));
}

/**
 * The intersection of the ray from `origin`, in direction `bearing`
 * (degrees), with the circle `(centre, radius)` — the far root, i.e. the
 * point on the *near side* of the circle as seen from a point outside it.
 * This is the general shape of "an angle measured from a point that is not
 * a circle's own centre" (the moon's course, measured from the earth
 * against its off-centre large circle), which Sphere's `measureFrom` uses
 * so an author never derives the quadratic themselves.
 */
export function rayCircleFar(origin: Vec, bearing: number, centre: Vec, radius: number): Vec {
  const u = { x: Math.cos(bearing * (Math.PI / 180)), y: -Math.sin(bearing * (Math.PI / 180)) };
  const oc = sub(centre, origin);
  const proj = dot(oc, u);
  const perp2 = dot(oc, oc) - proj * proj;
  const disc = Math.max(0, radius * radius - perp2);
  const rho = proj + Math.sqrt(disc);
  return { x: origin.x + u.x * rho, y: origin.y + u.y * rho };
}

/**
 * The point where a ray leaving `origin` on bearing `toward` actually meets
 * the circle `(center, radius)`, as an ordinary Positioned other objects can
 * be centred on, drawn to, or hung off.
 *
 * This is the difference between a dial that agrees with itself and one that
 * doesn't. A *true* place is sighted from the centre of the ring, so "the
 * point at that longitude" and "where the ray lands" are the same spot. A
 * *mean* place is sighted from somewhere else — the sun's own circle's
 * centre, the moon's large circle's centre — and on a ring of finite radius
 * those two spots are not the same. Drawing the pointer one way and its tick
 * and its name the other leaves all three visibly disagreeing near the ring,
 * which is exactly where the figure is making its point. Resolve the
 * intersection once, here, and let the line, the tick and the label all be
 * placed from it.
 */
export function rayToCircle(
  origin: PointLike,
  toward: DirectionLike,
  center: PointLike,
  radius: Scalar,
): Positioned {
  return {
    position(f: Frame): Vec {
      const o = resolvePoint(origin, f);
      const c = resolvePoint(center, f);
      const r = resolveScalar(radius, f);
      // A zero radius is what an auto-sized ring reports while it is busy
      // measuring the scene (see ZodiacRing) — collapse onto the origin
      // rather than hand back a point on a circle that has no size yet.
      if (!(r > 0)) return { x: o.x, y: o.y };
      return rayCircleFar(o, resolveDirection(toward, o, f), c, r);
    },
  };
}

/**
 * The point on a circle at the bearing `toward`, *as counted from*
 * `origin` — the same construction as `rayToCircle`, minus the parallax.
 *
 * The two differ only when `origin` is not the circle's own centre, and
 * what the difference is worth turning on depends entirely on what the
 * circle is standing for. A circle that is really there at the radius
 * drawn (a wheel, a rim, a track) meets the ray where it meets it:
 * `rayToCircle`. A circle standing in for the sky does not: the sky is
 * infinitely far off, every direction counted from anywhere in the figure
 * arrives at the same point on it, and the reading belongs at the bearing
 * itself, measured from the centre. Drawing it where the ray happens to
 * cross a ring of finite radius puts it out by `offset / radius` radians —
 * on the Rambam orrery, up to two degrees of a thirty-degree sign, which
 * is a misreading and not a rounding.
 */
export function directionOnCircle(
  origin: PointLike,
  toward: DirectionLike,
  center: PointLike,
  radius: Scalar,
): Positioned {
  return {
    position(f: Frame): Vec {
      const o = resolvePoint(origin, f);
      const c = resolvePoint(center, f);
      const r = resolveScalar(radius, f);
      // see rayToCircle: a ring still measuring itself reports no radius
      if (!(r > 0)) return { x: o.x, y: o.y };
      const d = polar(resolveDirection(toward, o, f), r);
      return { x: c.x + d.x, y: c.y + d.y };
    },
  };
}

/** A point that eases from `a` to `b` as `k` goes 0→1 — Orrery's `place()`
 * lerping a body from its "free" position to its "shell" position as a mode
 * transition runs is exactly this, made reusable: declare both positions as
 * ordinary objects and blend between them, rather than writing the lerp by
 * hand inside a draw function. */
export function lerpPoint(a: PointLike, b: PointLike, k: Scalar): Positioned {
  return {
    position(f: Frame): Vec {
      const pa = resolvePoint(a, f);
      const pb = resolvePoint(b, f);
      const t = resolveScalar(k, f);
      return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
    },
  };
}

/** The Scalar equivalent of lerpPoint — for blending a radius, an
 * eccentricity, an opacity, anything single-valued, between two Scalars. */
export function lerpScalar(a: Scalar, b: Scalar, k: Scalar): Scalar {
  return (f: Frame) => {
    const va = resolveScalar(a, f);
    const vb = resolveScalar(b, f);
    const t = resolveScalar(k, f);
    return va + (vb - va) * t;
  };
}

/**
 * The `id`/`name` plumbing every scene object needs, and nothing else —
 * Sphere, Anchor, Angle, Connector and Trail each `extend SceneObject<...>`
 * rather than repeating a constructor and two getters five times. `cfg`
 * stays public: scene.ts and an author both read config fields straight off
 * an instance, and a getter per field would just be more of the boilerplate
 * this exists to remove.
 */
export abstract class SceneObject<C extends Meta> {
  constructor(public cfg: C) {}
  get id(): string {
    return this.cfg.id;
  }
  get name(): string {
    return this.cfg.name;
  }
}

/** A named, describable thing — every scene object carries this much so a
 * diagram can hand a user "what is this" without a parallel lookup table. */
export interface Meta {
  id: string;
  name: string;
  /** the Hebrew name, shown as the label's second line by convention in
   * this kit — omit for a construction that has none */
  nameHe?: string;
  /** a sentence or two — shown as the hover tooltip's second line, a
   * separate channel from `nameHe`: nameHe labels the point, description
   * explains it */
  description?: string;
  color?: string;
  /** overall opacity, 0–1, possibly a function of the frame — the mechanism
   * every mode crossfade in this kit's figures is built from */
  opacity?: Scalar;
  /**
   * The English gloss shown *beneath* this object's headline — "the sun's
   * apogee (12:2)", "not the earth (11:13)". A separate channel from both
   * `nameHe` (which is a name, and under `hebrewFirst` becomes the
   * headline) and `description` (which is the hover tooltip's second line,
   * and can be a couple of sentences). A gloss is the one short line that
   * has to fit on the figure itself.
   */
  gloss?: string | ((f: Frame) => string);
  /**
   * Label this object the way this kit's Rambam figures label a
   * *construction*, rather than a body: the Hebrew name as the headline —
   * because in these figures the Hebrew names carry the argument — with
   * `gloss` beneath it. An object with no `nameHe` is one the text implies
   * but never names, so its English name becomes the headline instead, set
   * in `SceneTheme.inferredFont` rather than the Hebrew face, so a name he
   * gives and a name he doesn't never read as the same kind of thing.
   *
   * Off by default: a body ("The sun", with 'חמה' beneath) reads the other
   * way round, and that is the ordinary case.
   */
  hebrewFirst?: boolean;
  /** which way from its own point this object's label would rather sit.
   * Each kind has a sensible default (outward from a sphere's centre,
   * outward from an angle's vertex); set this for the exceptions — a name
   * that belongs beside a line rather than beyond it. */
  labelDir?: Vec | ((f: Frame) => Vec);
  /** set this object's label in a face of its own, rather than the one the
   * SceneTheme picks for its kind — for the one or two things in a figure
   * that are a different size of statement from everything around them. */
  labelFont?: Face;
  /** likewise for its second line. */
  labelSubFont?: Face;
  /** who keeps their name when there isn't room for everyone; lower ranks
   * are tried first, matching drawLabels()'s own convention */
  labelRank?: number;
  /** clearance between the point and its label, world px */
  labelGap?: number;
  /** name this object at all. Default true. */
  showLabel?: boolean;
  /** leave this object out of `Scene.extent()` — and so out of whatever
   * sizes itself from it, an auto-sized zodiac ring above all. For the one
   * shape that would otherwise chase its own tail: a sightline or shell
   * drawn *out to* the ring, which every frame would measure as the
   * furthest thing in the scene and push the ring further out again. It is
   * still drawn, hovered and labelled exactly as before. */
  excludeFromExtent?: boolean;
  /** draw order relative to other objects — lower first. Each object kind
   * has a sensible default on the same scale scene.ts's `LAYER` names
   * (shells 0, trails 5, anchors 8, connectors 10, angles 20, bodies 30);
   * set this only to break out of it, e.g. `layer: LAYER.body + 1` to draw
   * above every ordinary body. */
  layer?: number;
}

/**
 * Everything a custom body renderer needs to draw one screen-space dot: not
 * just where and how big, but the camera (so a renderer can read live zoom
 * for its own emphasis, the way Orrery grows a body a little as you zoom
 * in) and a light direction (so "lit from the sun's side, Saturn's ring,
 * the sun's corona" — Orrery's `drawBody`/`drawSaturnRing` — is buildable
 * as a `render` callback rather than requiring a fork of Scene itself).
 * Runs in screen space, after the world-space camera transform has been
 * undone, because gradients, rotation and clipping (a ring's tilt, a lit
 * hemisphere's terminator) don't scale correctly under a zoomed transform.
 */
export interface BodyRenderContext {
  screen: Vec;
  world: Vec;
  /** the resolved base radius, screen px (from `dotSize`) — a renderer is
   * free to use it as-is or scale it further using `camera` */
  r: number;
  f: Frame;
  camera: Camera;
  /** matches the object's `color` config — named to agree with what an
   * author already wrote on the Sphere */
  color: string;
  /** under the pointer this frame */
  hot: boolean;
  /** the object's resolved opacity — apply this yourself; Scene does not
   * wrap your renderer in a globalAlpha, since a "lit sphere" often wants
   * some of its layers (a glow) at a different alpha than its disc */
  alpha: number;
  /** unit vector, screen space, from this body toward the scene's light
   * source — set only when the Scene draw call was given one. Widened to
   * `| undefined` (not just an omittable key) under
   * exactOptionalPropertyTypes: Scene builds this object with `light:
   * lightScreen !== undefined ? unit(...) : undefined` rather than
   * conditionally spreading the key away, since this literal is built once
   * per body per frame. */
  light?: Vec | undefined;
}

export type BodyRenderer = (ctx: CanvasRenderingContext2D, b: BodyRenderContext) => void;
