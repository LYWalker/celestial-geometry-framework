/**
 * A line between two points that may themselves be moving — a radius from a
 * sphere's centre to the body riding it, a dashed sightline from the earth
 * toward a direction rather than a path. The author gives two PointLikes —
 * or, for a sightline that has no real endpoint, a direction and a length —
 * and where they are at a given moment is never something they compute by hand.
 */

import { FULL_CIRCLE, polar, unit, type Vec } from '../geometry.js';
import { arrowHead } from '../annotate.js';
import {
  type BoolLike,
  type DirectionLike,
  type Frame,
  type Meta,
  type PointLike,
  type Scalar,
  SceneObject,
  resolveBool,
  resolveDirection,
  resolvePoint,
  resolveScalar,
} from './types.js';

export interface ConnectorConfig extends Meta {
  from: PointLike;
  /** the line's other end — a point, or omit this and use `toward`/`length`
   * for a sightline that has no real endpoint of its own (a direction to an
   * apogee, say, rather than to any object standing there). One of `to` or
   * `toward` is required — a Connector with neither would draw an invisible
   * zero-length line with nothing to explain why, so it throws instead. */
  to?: PointLike;
  /** a bearing from `from`, used with `length` instead of `to` */
  toward?: DirectionLike;
  /** how far along `toward` to draw, world px */
  length?: Scalar;
  /** solid by default; dashed for "a direction, not a path" */
  dashed?: boolean;
  /** stop short of `to` rather than reaching it — useful when `to` is a body
   * drawn with its own radius, so the line doesn't run under the dot */
  shorten?: number;
  /** put an arrowhead on the `to` end — for a line that asserts a
   * *direction* ("the far point is that way") rather than joining two things
   * that are both already drawn. Sized on screen, like an Angle's. */
  arrow?: BoolLike;
  /** where along the line to hang its name, 0 (`from`) to 1 (`to`). Default
   * 0.5. A sightline drawn out to a point the construction names — an
   * apogee, a far point — wants its name at the end it is asserting, not
   * halfway down a line that is only there to get there. */
  labelAt?: number;
  lineWidth?: number;
}

/** A Connector arrowhead's size, screen px — the same as an Angle's, so a
 * "which way" mark means the same thing wherever it appears in a figure. */
const ARROW_SIZE_PX = 5.5;

export class Connector extends SceneObject<ConnectorConfig> {
  readonly kind = 'connector' as const;

  // Same Frame-identity memoisation as Sphere/Angle: fromAt()/toAt() are
  // each called several times a frame (once to draw, once for the hover
  // zone, once from toAt() itself resolving fromAt() internally) and would
  // otherwise each re-walk `from`/`to`/`toward` for themselves every time.
  private memoFrame: Frame | null = null;
  private memoFrom?: Vec;
  private memoTo?: Vec;

  constructor(cfg: ConnectorConfig) {
    super(cfg);
    if (cfg.to === undefined && cfg.toward === undefined) {
      throw new Error(
        `canvas-diagram Connector "${cfg.id}": needs either \`to\` or \`toward\`/\`length\` — neither was given, which would silently draw an invisible zero-length line.`,
      );
    }
  }

  /** Force the next fromAt()/toAt()/draw() call to re-resolve both ends,
   * even within the same Frame object — see Sphere.invalidate()'s own doc;
   * same `cfg`-mutation contract, same escape hatch. */
  invalidate(): void {
    this.memoFrame = null;
  }

  fromAt(f: Frame): Vec {
    this.resolve(f);
    // Copied out, not handed back by reference — same reasoning as
    // Sphere.centerAt()/position(): this is our own memo, read again by
    // draw()/toAt() and by Scene for the rest of the frame, and a caller
    // mutating what fromAt() returns would otherwise corrupt it for them.
    return { x: this.memoFrom!.x, y: this.memoFrom!.y };
  }

  toAt(f: Frame): Vec {
    this.resolve(f);
    return { x: this.memoTo!.x, y: this.memoTo!.y };
  }

  /**
   * The memo is *published last*, once both endpoints are computed — never
   * before. Claiming this frame up front and filling the values in
   * afterwards looks equivalent and isn't: anything reached while resolving
   * (a `length` Scalar that asks something else about this same frame — an
   * auto-sized ZodiacRing being the real case) can read this connector back
   * mid-flight, and would then be handed the *previous* frame's endpoints
   * as though they were this frame's. That stale read is invisible in the
   * drawing and vicious in a measurement: the ring measured a line whose
   * length was the last ring, grew to clear it, and grew again every frame
   * after. A re-entrant read now simply recomputes, which terminates
   * because whatever it re-enters is itself mid-flight and answers with its
   * own base case.
   */
  private resolve(f: Frame): void {
    if (this.memoFrame === f) return;
    const a = resolvePoint(this.cfg.from, f);
    const raw = this.rawToAt(a, f);
    const from = { x: a.x, y: a.y };

    const shorten = this.cfg.shorten;
    let to: Vec;
    if (!shorten) {
      to = { x: raw.x, y: raw.y };
    } else {
      const dx = raw.x - a.x;
      const dy = raw.y - a.y;
      const len = Math.hypot(dx, dy);
      const k = Math.max(0, len - shorten) / (len || 1);
      to = { x: a.x + dx * k, y: a.y + dy * k };
    }
    this.memoFrom = from;
    this.memoTo = to;
    this.memoFrame = f;
  }

  /** The line's other end before `shorten` is applied. */
  private rawToAt(a: Vec, f: Frame): Vec {
    if (this.cfg.to !== undefined) return resolvePoint(this.cfg.to, f);
    const dir = resolveDirection(this.cfg.toward ?? 0, a, f);
    const len = resolveScalar(this.cfg.length ?? 0, f);
    const p = polar(dir, len);
    return { x: a.x + p.x, y: a.y + p.y };
  }

  /** This call's own `color` argument, if given, wins over `cfg.color` — see
   * Angle.draw's own note; same reasoning, same fix. */
  draw(ctx: CanvasRenderingContext2D, f: Frame, zoom: number, color?: string): void {
    const a = this.fromAt(f);
    const b = this.toAt(f);
    ctx.save();
    ctx.strokeStyle = color ?? this.cfg.color ?? '#fff';
    ctx.lineWidth = (this.cfg.lineWidth ?? 1) / zoom;
    if (this.cfg.dashed) ctx.setLineDash([6 / zoom, 5 / zoom]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (resolveBool(this.cfg.arrow, f)) {
      const d = { x: b.x - a.x, y: b.y - a.y };
      if (Math.hypot(d.x, d.y) > 1e-9) {
        // solid even on a dashed line: the dashes say "a direction, not a
        // path", the head says which way along it — two different claims,
        // and a dashed arrowhead reads as neither
        ctx.setLineDash([]);
        arrowHead(ctx, b, unit(d), ARROW_SIZE_PX / zoom);
      }
    }
    ctx.restore();
  }

  /** Where to hang this connector's name — `labelAt` of the way along it. */
  labelPointAt(f: Frame): Vec {
    const a = this.fromAt(f);
    const b = this.toAt(f);
    const k = this.cfg.labelAt ?? 0.5;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
}

/** A small cross marking a point — the Rambam's own convention for a
 * circle's centre when it is not the earth. `ring` adds a small circle
 * through the arms, which is how a centre the construction keeps referring
 * back to is drawn, as against a bare crossing of two lines. World-space;
 * call inside the caller's applyCamera block. */
export function drawCenterMark(
  ctx: CanvasRenderingContext2D,
  p: Vec,
  zoom: number,
  color: string,
  size = 5,
  ring = false,
): void {
  const s = size / zoom;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 / zoom;
  ctx.beginPath();
  ctx.moveTo(p.x - s, p.y);
  ctx.lineTo(p.x + s, p.y);
  ctx.moveTo(p.x, p.y - s);
  ctx.lineTo(p.x, p.y + s);
  ctx.stroke();
  if (ring) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, s * 0.5, 0, FULL_CIRCLE);
    ctx.stroke();
  }
  ctx.restore();
}
