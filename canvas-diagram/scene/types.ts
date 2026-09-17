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

import { type Vec, dot, lonOf, sub } from '../geometry';
import type { Camera } from '../camera';

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

export function resolvePoint(p: PointLike | undefined, f: Frame): Vec {
  if (p === undefined) return { x: 0, y: 0 };
  if (typeof p === 'function') return p(f);
  if ('position' in p) return p.position(f);
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
  /** who keeps their name when there isn't room for everyone; lower ranks
   * are tried first, matching drawLabels()'s own convention */
  labelRank?: number;
  /** clearance between the point and its label, world px */
  labelGap?: number;
  /** name this object at all. Default true. */
  showLabel?: boolean;
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
   * author already wrote on the Sphere, not with this kit's internal
   * British spelling (Label.colour, HoverZone.colour) that a BodyRenderer
   * never touches */
  color: string;
  /** under the pointer this frame */
  hot: boolean;
  /** the object's resolved opacity — apply this yourself; Scene does not
   * wrap your renderer in a globalAlpha, since a "lit sphere" often wants
   * some of its layers (a glow) at a different alpha than its disc */
  alpha: number;
  /** unit vector, screen space, from this body toward the scene's light
   * source — set only when the Scene draw call was given one */
  light?: Vec;
}

export type BodyRenderer = (ctx: CanvasRenderingContext2D, b: BodyRenderContext) => void;
