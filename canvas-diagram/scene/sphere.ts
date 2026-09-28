/**
 * A circular shell: something can be nested inside it, offset from its
 * centre, and something rides its rim at a turning rate. That one shape
 * covers every construction this kit's figures need —
 *
 *   - a plain nested shell ("the ladder of galgalim"): centre on an anchor,
 *     increasing radius, nothing riding it (showBody: false)
 *   - a body on a circular path: centre on an anchor, `speed` or `angle` set
 *   - an eccentric circle (the sun's own circle, off from the earth):
 *     the same, plus `eccentric` to shift its centre away from `center`
 *   - an epicycle (the moon's small sphere, riding the big one's rim): a
 *     second Sphere whose `center` *is* the first Sphere — centerAt() then
 *     resolves to the first sphere's current position, automatically
 *   - an angle measured from a point that isn't the circle's own centre
 *     (the moon's course, measured from the earth against its off-centre
 *     large circle): `measureFrom` — the ray/circle intersection this needs
 *     is derived, never written out by hand
 *
 * so a diagram author never derives polar coordinates by hand: they say what
 * a sphere is centred on, how far off-centre, how big, and how it turns, and
 * position(f) is always "where the thing on it actually is."
 */

import { onPlane, polar, norm360, type PlanePoint, type TiltedPlane, type Vec } from '../geometry.js';
import {
  type BodyRenderer,
  type BoolLike,
  type DirectionLike,
  type Frame,
  type Meta,
  type PointLike,
  type Positioned,
  type Scalar,
  ORIGIN,
  SceneObject,
  rayCircleFar,
  resolveDirection,
  resolvePoint,
  resolveScalar,
} from './types.js';

export interface EccentricConfig {
  /** the offset as a fraction of this sphere's own radius (0–1) — a plain
   * number for a fixed offset, or a function of the frame for one that
   * depends on a UI toggle or another transition (e.g. `(f) => f.eccentric
   * ? 0.2 : 0` for an "off-centre orbit" switch). The moon's large circle
   * sits at e = 1/5 of its radius from the earth this way (KH 15:3). */
  ratio: Scalar;
  /** which way the offset points: a fixed bearing (the apogee), or
   * something that moves (the moon's centre runs round the earth once a month) */
  direction: DirectionLike;
}

/**
 * Tip this sphere's whole plane out of the page — an orbit inclined to the
 * one the figure is drawn in. Stated the way the sky states it: how far it
 * is tipped, and the bearing of the line of nodes it is tipped about.
 *
 * The projection is exact, not an impression. `angle` is then measured
 * *within the tilted plane* (a body's argument of latitude), the projected
 * bearing that comes out is its longitude in the flat plane, and
 * `depthAt()` is its real height above that plane. See `onPlane`.
 */
export interface PlaneConfig {
  /** degrees out of the page — a Scalar, so a figure can exaggerate a
   * small inclination under a slider without lying about anything else */
  tilt: Scalar;
  /** the bearing of the line of nodes; a DirectionLike, since real nodes
   * move (the moon's regress once round in 18.6 years) */
  nodes: DirectionLike;
  /** how much of its opacity the half behind the flat plane keeps, 0-1.
   * Default 0.4 — enough to read as a continuing line, little enough that
   * which half is in front is never in question. */
  behindFade?: number;
}

export interface SphereConfig extends Meta {
  /** this sphere's own radius, world px — a fixed size, or a function of
   * the frame for a construction whose reach changes (a distance-scale
   * toggle, say: `(f) => lerp(squashed, true, f.scaleT)`) */
  radius: Scalar;
  /** what this sphere is centred on. A plain Vec or Anchor for a shell about
   * a fixed point; another Sphere/Positioned to ride that object's current
   * position (an epicycle). Defaults to the origin. */
  center?: PointLike;
  /** shift this sphere's centre away from `center` — an eccentric circle */
  eccentric?: EccentricConfig;
  /** degrees per unit of the frame's clock (`f.t`) that the carried point
   * advances at a constant rate; 0 (the default) for a sphere that only
   * exists as a shell for others to sit on or in. Ignored when `angle` is set. */
  speed?: number;
  /** the carried point's bearing at `f.t = 0`, under `speed`. Ignored when
   * `angle` is set. */
  phase?: number;
  /** the carried point's bearing outright, as a function of the frame —
   * for a body whose motion isn't a constant rate (every real ephemeris:
   * `angle: (f) => rambamSun(f.t).mean`). Takes precedence over
   * `speed`/`phase` when given. */
  angle?: Scalar;
  /**
   * What `angle`, or `phase` and `speed`, are counted from. `'east'` (the
   * default) is an ordinary bearing. `'carrier'` counts from the line the
   * sphere this one is centred on carries it along — its own `angleAt` — which
   * is how the Rambam states an epicycle's motion: the moon's course (14:3) is
   * reckoned on the small sphere from its far point, the end of the line out
   * from the earth, not from a fixed direction in the sky. Stated that way,
   * the text's own number goes in unchanged.
   */
  countFrom?: 'east' | 'carrier';
  /**
   * Turns clockwise: `angle`, or `phase` and `speed`, are counted clockwise
   * rather than the usual anticlockwise. The same as negating them, but it
   * lets a motion the source states as a positive number in its own
   * direction — the moon's course on the small sphere, which turns against
   * the large one (14:3) — go in as that number.
   */
  clockwise?: boolean;
  /** tip this sphere's plane out of the page (see PlaneConfig). Its rim
   * then draws as an ellipse rather than a circle, and the carried point
   * gains a real depth, which `depthAt()` reports. Cannot be combined with
   * `measureFrom`, which solves a ray against a circle and has no meaning
   * against a tilted one — the constructor rejects the pair rather than
   * quietly drawing something that isn't the construction asked for. */
  plane?: PlaneConfig;
  /** measure `angle` from this point instead of from this sphere's own
   * centre, and place the carried point at the near intersection of that
   * ray with this sphere's rim — the construction the Rambam's moon needs
   * (its course is counted from the earth, not from the large circle's
   * off-centre centre). Defaults to this sphere's own centre. */
  measureFrom?: PointLike;
  /** draw this sphere's rim as a ring. Default true. (Named for what it
   * does, not "visible" — a Sphere with `showRing: false, showBody: true`
   * is entirely visible, just ringless.) */
  showRing?: boolean;
  /** draw the carried point (position(f)) as a dot with a label. Default
   * true whenever `speed` or `angle` is set; false for a bare shell nothing rides. */
  showBody?: boolean;
  /** put a small cross at this sphere's own centre — the Rambam's own
   * convention for marking a circle's centre when it isn't the earth.
   * Accepts a function of the frame, so it can follow a UI toggle (an
   * "off-centre orbit" switch) rather than being fixed when the Sphere is built. */
  markCenter?: BoolLike;
  /** px radius of the drawn dot, when showBody is true — screen px, a
   * constant on-screen size regardless of zoom, like a map pin */
  dotSize?: number;
  /** draw the carried body yourself — a lit sphere, a ring, a corona —
   * instead of Scene's default plain dot. See BodyRenderer. */
  render?: BodyRenderer;
  /** name a bare shell (showBody: false) at this bearing on its own rim,
   * the way Orrery names each of the nine galgalim low on the left where
   * the figure is otherwise quiet. Has no effect when showBody is true —
   * the carried body's own label covers that case. */
  labelAt?: DirectionLike;
}

export class Sphere extends SceneObject<SphereConfig> implements Positioned {
  readonly kind = 'sphere' as const;

  // Memoised per Frame *object identity*: a diagram builds one Frame per
  // draw() call and threads it through every position()/radiusAt() call, so
  // re-deriving the same sphere's centre three times in one frame (once for
  // itself, once for each child riding it) is wasted work — and for a chain
  // a few epicycles deep, backed by a real ephemeris function, not cheap
  // wasted work. A new Frame object invalidates the cache automatically.
  private memoFrame: Frame | null = null;
  // Explicit `| undefined` rather than the `?:` shorthand: resetIfStale()
  // below assigns `undefined` to all four outright to invalidate them, which
  // exactOptionalPropertyTypes treats as a different (and, for a private
  // field only ever read after resetIfStale() has run, more honest) type
  // than "the property may be omitted."
  private memoCenter: Vec | undefined;
  private memoRadius: number | undefined;
  private memoAngle: number | undefined;
  private memoPosition: Vec | undefined;
  private memoPlane: TiltedPlane | undefined;

  constructor(cfg: SphereConfig) {
    super(cfg);
    if (cfg.plane !== undefined && cfg.measureFrom !== undefined) {
      throw new Error(
        `canvas-diagram Sphere "${cfg.id}": \`plane\` and \`measureFrom\` can't be combined — ` +
          `measureFrom solves a ray against this sphere's *circle*, which a tilted plane no longer is. ` +
          `Drop one, or express the tilted case as its own object.`,
      );
    }
    if (cfg.labelAt !== undefined && (cfg.showBody ?? (cfg.speed !== undefined || cfg.angle !== undefined))) {
      console.warn(
        `canvas-diagram Sphere "${cfg.id}": labelAt has no effect when showBody is true — the carried body's own label covers that case.`,
      );
    }
  }

  private resetIfStale(f: Frame): void {
    if (this.memoFrame !== f) {
      this.memoFrame = f;
      this.memoCenter = this.memoRadius = this.memoAngle = this.memoPosition = undefined;
      this.memoPlane = undefined;
    }
  }

  /** Force the next `radiusAt()`/`centerAt()`/`angleAt()`/`position()` call
   * to recompute, even within the *same* Frame object — the escape hatch
   * for `cfg`'s own contract (see `SceneObject`'s doc, and the README):
   * `cfg` is public and author-writable, but this sphere's memo otherwise
   * has no way to know a field changed mid-frame (a UI control's change
   * handler firing between two draw() calls that share a Frame, say).
   * Mutate `cfg`, then call `invalidate()`. */
  invalidate(): void {
    this.memoFrame = null;
  }

  get showBody(): boolean {
    return this.cfg.showBody ?? (this.cfg.speed !== undefined || this.cfg.angle !== undefined);
  }
  get showRing(): boolean {
    return this.cfg.showRing ?? true;
  }

  radiusAt(f: Frame): number {
    this.resetIfStale(f);
    if (this.memoRadius === undefined) this.memoRadius = Math.max(0, resolveScalar(this.cfg.radius, f));
    return this.memoRadius;
  }

  /** This sphere's own centre — `center` shifted by `eccentric`, if any. */
  centerAt(f: Frame): Vec {
    this.resetIfStale(f);
    if (this.memoCenter === undefined) {
      const base = resolvePoint(this.cfg.center ?? ORIGIN, f);
      const ecc = this.cfg.eccentric;
      if (!ecc) {
        // Copied, not aliased: `base` may be the frozen ORIGIN or the
        // author's own `center: {x, y}` literal — handing either back
        // directly would let a caller's mutation (or an attempted one, on
        // the frozen case) corrupt or throw on what looks like a plain
        // return value.
        this.memoCenter = { x: base.x, y: base.y };
      } else {
        const r = resolveScalar(ecc.ratio, f) * this.radiusAt(f);
        const dir = resolveDirection(ecc.direction, base, f);
        // The offset lies in this sphere's own plane, so when that plane is
        // tilted the offset is foreshortened with it. Reading `cfg.plane`
        // directly rather than via planeAt(), which would recurse: planeAt
        // resolves its `nodes` DirectionLike against this very centre.
        const p = this.cfg.plane;
        const off = p
          ? onPlane(dir, r, { tilt: resolveScalar(p.tilt, f), nodes: resolveDirection(p.nodes, base, f) })
          : polar(dir, r);
        this.memoCenter = { x: base.x + off.x, y: base.y + off.y };
      }
    }
    // Copied out, not handed back by reference: the memo above is our own
    // cached state, read again by every child riding this sphere for the
    // rest of the frame — a caller that mutates what centerAt() returns
    // (directly, or via a library that mutates points in place) would
    // otherwise corrupt that cache for everyone downstream. Same fix, same
    // reasoning, as the "copied, not aliased" comment just above for the
    // memo's own construction; the miss was only ever on the way out.
    return { x: this.memoCenter.x, y: this.memoCenter.y };
  }

  /** The carried point's bearing — from `angle` if given, else a constant
   * rate from `phase`/`speed`, plus the carrier's own bearing under
   * `countFrom: 'carrier'`. Measured from this sphere's own centre. */
  angleAt(f: Frame): number {
    this.resetIfStale(f);
    if (this.memoAngle === undefined) {
      const own =
        (this.cfg.clockwise ? -1 : 1) *
        (this.cfg.angle !== undefined
          ? resolveScalar(this.cfg.angle, f)
          : (this.cfg.phase ?? 0) + (this.cfg.speed ?? 0) * f.t);
      this.memoAngle = norm360(own + (this.cfg.countFrom === 'carrier' ? this.carrierBearing(f) : 0));
    }
    return this.memoAngle;
  }

  /** The bearing the sphere this one rides is carrying it along — the zero
   * that `countFrom: 'carrier'` counts from. Zero when it rides nothing that
   * turns. */
  private carrierBearing(f: Frame): number {
    const c = this.cfg.center as unknown;
    if (c !== null && typeof c === 'object' && typeof (c as { angleAt?: unknown }).angleAt === 'function') {
      const a = (c as { angleAt: (f: Frame) => number }).angleAt(f);
      return Number.isFinite(a) ? a : 0;
    }
    return 0;
  }

  /** This sphere's plane at this moment, or null when it lies flat in the
   * page like everything else. */
  planeAt(f: Frame): TiltedPlane | null {
    const p = this.cfg.plane;
    if (!p) return null;
    this.resetIfStale(f);
    if (this.memoPlane === undefined) {
      this.memoPlane = {
        tilt: resolveScalar(p.tilt, f),
        // normalised, like angleAt(): the maths is indifferent, but a figure
        // that reads this back to print it or to draw the node line itself
        // should get a bearing, not whatever a Scalar happened to return
        nodes: norm360(resolveDirection(p.nodes, this.centerAt(f), f)),
      };
    }
    return this.memoPlane;
  }

  /** How far the carried point stands out of the page, in world px —
   * positive toward the viewer, negative away, and 0 for a sphere lying
   * flat. A figure reads this to fade what is behind, to drop a
   * perpendicular to the flat plane, or to print the height itself. */
  depthAt(f: Frame): number {
    const plane = this.planeAt(f);
    if (!plane) return 0;
    return onPlane(this.angleAt(f), this.radiusAt(f), plane).depth;
  }

  /** The rim, sampled and projected — an ellipse when this sphere is
   * tilted, and what every planed ring in this kit is drawn, hovered and
   * highlighted from, since `ctx.arc` cannot draw one. Each point carries
   * its own depth, so a caller can split the near half from the far. */
  rimAt(f: Frame, from = 0, to = 360, n = 64): PlanePoint[] {
    const plane = this.planeAt(f);
    const c = this.centerAt(f);
    const r = this.radiusAt(f);
    const pts: PlanePoint[] = [];
    // n = 0 means "just the point at `from`" — the shape a label or a node
    // marker asks for. Dividing by it would return NaN, which does not fail
    // here but far away, as a label direction or a hover zone.
    const step = n > 0 ? (to - from) / n : 0;
    for (let i = 0; i <= n; i++) {
      const lon = from + step * i;
      if (plane) {
        const p = onPlane(lon, r, plane);
        pts.push({ x: c.x + p.x, y: c.y + p.y, depth: p.depth });
      } else {
        const p = polar(lon, r);
        pts.push({ x: c.x + p.x, y: c.y + p.y, depth: 0 });
      }
    }
    return pts;
  }

  /** Where the thing riding this sphere's rim actually is — the number every
   * other object (a nested sphere, an angle, a connector) reads off it. */
  position(f: Frame): Vec {
    this.resetIfStale(f);
    if (this.memoPosition === undefined) {
      const c = this.centerAt(f);
      const r = this.radiusAt(f);
      if (this.cfg.measureFrom !== undefined) {
        const origin = resolvePoint(this.cfg.measureFrom, f);
        this.memoPosition = rayCircleFar(origin, this.angleAt(f), c, r);
      } else {
        const plane = this.planeAt(f);
        const p = plane ? onPlane(this.angleAt(f), r, plane) : polar(this.angleAt(f), r);
        this.memoPosition = { x: c.x + p.x, y: c.y + p.y };
      }
    }
    // Copied out, not handed back by reference — see centerAt()'s own note;
    // same hazard (this is the memo a whole chain of dependents reads back
    // for the rest of the frame), same fix.
    return { x: this.memoPosition.x, y: this.memoPosition.y };
  }
}

/** A small convenience for the common case of several shells nested evenly —
 * "one above the other like the layers of an onion" — so an author writes
 * `nest.next()` for each radius instead of hand-adding a gap each time. */
export function nester(start: number, gap: number) {
  // seeded one gap short, so the first next() lands on `start` itself
  let r = start - gap;
  return {
    next(): number {
      r += gap;
      return r;
    },
  };
}
