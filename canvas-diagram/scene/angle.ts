/**
 * An annotated angle: an arc swept between two directions from a vertex,
 * with an arrowhead for which way it went and, if asked, its value written
 * on it — "the course, turned from the apogee," "5° 8′ added to the mean."
 * The author states the vertex and the two directions (bearings, or "point
 * at that other object"); sweep(), the arrowhead and the value are all
 * computed, never hand-drawn.
 */

import { norm360, polar, type Vec } from '../geometry';
import { sweep, sweepShort, midOf } from '../annotate';
import {
  type DirectionLike,
  type Frame,
  type Meta,
  type PointLike,
  type Scalar,
  SceneObject,
  resolveDirection,
  resolvePoint,
  resolveScalar,
} from './types';

export interface AngleConfig extends Meta {
  vertex: PointLike;
  from: DirectionLike;
  to: DirectionLike;
  /**
   * the arc's drawing radius, world px — a fixed size, or a function of the
   * frame. There's no separate "radius as a fraction of the vertex-to-target
   * distance" option because `radius` already is a Scalar: write
   * `radius: (f) => distanceBetween(vertex, to, f) * 0.4` (`distanceBetween`
   * is exported from `./types`, or the scene barrel) for an arc that stays a
   * constant fraction of the way out to whatever it's sighting at, and
   * survives the scene being rescaled without a second number to retune.
   */
  radius: Scalar;
  /**
   * true (the default): a *correction* — sweep whichever way is under 180°,
   * the way "add" or "subtract" is meant, and report `valueAt()` signed
   * (−180..180]. false: a *swept angle that can run all the way round* (a
   * double elongation, an hour angle) — always sweep anticlockwise from
   * `from` to `to`, and report `valueAt()` unsigned [0, 360). These are two
   * different quantities, not one with a formatting difference; pick
   * whichever matches what the angle means in the diagram.
   */
  short?: boolean;
  /** when `short` is false, which way to sweep from `from` to `to`. Default
   * false (anticlockwise) — Orrery's own convention for "the course, turned
   * from the apogee." Set true for a construction that specifically turns
   * the other way (the Rambam's moon rides its small sphere clockwise
   * against the large one: "the correct course," `sweep(M, r, mean,
   * mean−course, true)"). Ignored when `short` is true — a correction
   * always goes whichever way is under 180°, so there's nothing to choose. */
  clockwise?: boolean;
  /** show the numeric value (valueAt(), degrees) as the label's sub-line */
  showValue?: boolean;
  lineWidth?: number;
}

interface Sweep {
  c: Vec;
  r: number;
  from: number;
  to: number;
  cw: boolean;
}

export class Angle extends SceneObject<AngleConfig> {
  readonly kind = 'angle' as const;

  // Same Frame-identity memoisation as Sphere, and for the same reason:
  // draw()/hoverPts()/midAt()/valueAt() all need this one decision, and
  // without caching it each would re-resolve the vertex and both directions
  // for itself — up to four resolutions of the same thing per angle per frame.
  private memoFrame: Frame | null = null;
  private memoSweep?: Sweep;

  vertexAt(f: Frame): Vec {
    return resolvePoint(this.cfg.vertex, f);
  }
  fromAt(f: Frame): number {
    return resolveDirection(this.cfg.from, this.vertexAt(f), f);
  }
  toAt(f: Frame): number {
    return resolveDirection(this.cfg.to, this.vertexAt(f), f);
  }
  radiusAt(f: Frame): number {
    return Math.max(0, resolveScalar(this.cfg.radius, f));
  }

  /** The one decision every drawing/hovering/labelling method needs — made
   * once per Frame and reused, rather than each re-deriving `cw` and
   * re-resolving the two directions for itself. */
  private sweepOf(f: Frame): Sweep {
    if (this.memoFrame !== f) {
      this.memoFrame = f;
      const c = this.vertexAt(f);
      const r = this.radiusAt(f);
      const from = this.fromAt(f);
      const to = this.toAt(f);
      const cw = (this.cfg.short ?? true) ? norm360(to - from) > 180 : (this.cfg.clockwise ?? false);
      this.memoSweep = { c, r, from, to, cw };
    }
    return this.memoSweep!;
  }

  /** The signed (short: true) or unsigned (short: false) value of the sweep
   * this angle currently draws, degrees — see `AngleConfig.short`. */
  valueAt(f: Frame): number {
    const { from, to, cw } = this.sweepOf(f);
    if (this.cfg.short ?? true) {
      const d = norm360(to - from);
      return d > 180 ? d - 360 : d;
    }
    return cw ? norm360(from - to) : norm360(to - from);
  }

  /** Draw the arc and arrowhead. Call inside the caller's applyCamera block.
   * `colour`, if given, wins over `cfg.color` — Scene passes its own
   * already-themed fallback here, so a figure's stroke and its label/hover
   * colour for the same object never drift onto two different defaults. */
  draw(ctx: CanvasRenderingContext2D, f: Frame, zoom: number, colour?: string): void {
    const { c, r, from, to, cw } = this.sweepOf(f);
    ctx.save();
    ctx.strokeStyle = colour ?? this.cfg.color ?? '#fff';
    ctx.lineWidth = (this.cfg.lineWidth ?? 1) / zoom;
    if (this.cfg.short ?? true) sweepShort(ctx, c, r, from, to, zoom);
    else sweep(ctx, c, r, from, to, zoom, cw);
    ctx.restore();
  }

  /** Screen-space points along the sweep, for hover hit-testing — call with
   * a `toScreen` that already accounts for the camera. */
  hoverPts(f: Frame, toScreen: (p: Vec) => Vec, n = 16): Vec[] {
    const { c, r, from, to, cw } = this.sweepOf(f);
    const span = cw ? norm360(from - to) : norm360(to - from);
    const pts: Vec[] = [];
    for (let i = 0; i <= n; i++) {
      const a = from + (cw ? -1 : 1) * ((span * i) / n);
      const p = polar(a, r);
      pts.push(toScreen({ x: c.x + p.x, y: c.y + p.y }));
    }
    return pts;
  }

  /** Where to hang this angle's name — the middle of its sweep, in world space. */
  midAt(f: Frame): Vec {
    const { c, r, from, to, cw } = this.sweepOf(f);
    return midOf(c, r, from, to, cw);
  }
}
