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

import { polar, norm360, type Vec } from '../geometry';
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
} from './types';

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
  private memoCenter?: Vec;
  private memoRadius?: number;
  private memoAngle?: number;
  private memoPosition?: Vec;

  constructor(cfg: SphereConfig) {
    super(cfg);
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
    }
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
        const off = polar(dir, r);
        this.memoCenter = { x: base.x + off.x, y: base.y + off.y };
      }
    }
    return this.memoCenter;
  }

  /** The carried point's bearing — from `angle` if given, else a constant
   * rate from `phase`/`speed`. Measured from this sphere's own centre. */
  angleAt(f: Frame): number {
    this.resetIfStale(f);
    if (this.memoAngle === undefined) {
      this.memoAngle =
        this.cfg.angle !== undefined
          ? norm360(resolveScalar(this.cfg.angle, f))
          : norm360((this.cfg.phase ?? 0) + (this.cfg.speed ?? 0) * f.t);
    }
    return this.memoAngle;
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
        const p = polar(this.angleAt(f), r);
        this.memoPosition = { x: c.x + p.x, y: c.y + p.y };
      }
    }
    return this.memoPosition;
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
