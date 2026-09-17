/**
 * A line between two points that may themselves be moving — a radius from a
 * sphere's centre to the body riding it, a dashed sightline from the earth
 * toward a direction rather than a path. The author gives two PointLikes —
 * or, for a sightline that has no real endpoint, a direction and a length —
 * and where they are at a given moment is never something they compute by hand.
 */

import { polar, type Vec } from '../geometry';
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
  lineWidth?: number;
}

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

  fromAt(f: Frame): Vec {
    this.resolve(f);
    return this.memoFrom!;
  }

  toAt(f: Frame): Vec {
    this.resolve(f);
    return this.memoTo!;
  }

  private resolve(f: Frame): void {
    if (this.memoFrame === f) return;
    this.memoFrame = f;
    const a = resolvePoint(this.cfg.from, f);
    const raw = this.rawToAt(a, f);
    this.memoFrom = { x: a.x, y: a.y };

    const shorten = this.cfg.shorten;
    if (!shorten) {
      this.memoTo = { x: raw.x, y: raw.y };
      return;
    }
    const dx = raw.x - a.x;
    const dy = raw.y - a.y;
    const len = Math.hypot(dx, dy);
    const k = Math.max(0, len - shorten) / (len || 1);
    this.memoTo = { x: a.x + dx * k, y: a.y + dy * k };
  }

  /** The line's other end before `shorten` is applied. */
  private rawToAt(a: Vec, f: Frame): Vec {
    if (this.cfg.to !== undefined) return resolvePoint(this.cfg.to, f);
    const dir = resolveDirection(this.cfg.toward ?? 0, a, f);
    const len = resolveScalar(this.cfg.length ?? 0, f);
    const p = polar(dir, len);
    return { x: a.x + p.x, y: a.y + p.y };
  }

  /** `colour`, if given, wins over `cfg.color` — see Angle.draw's own note;
   * same reasoning, same fix. */
  draw(ctx: CanvasRenderingContext2D, f: Frame, zoom: number, colour?: string): void {
    const a = this.fromAt(f);
    const b = this.toAt(f);
    ctx.save();
    ctx.strokeStyle = colour ?? this.cfg.color ?? '#fff';
    ctx.lineWidth = (this.cfg.lineWidth ?? 1) / zoom;
    if (this.cfg.dashed) ctx.setLineDash([6 / zoom, 5 / zoom]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}

/** A small cross marking a point — the Rambam's own convention for a
 * circle's centre when it is not the earth. World-space; call inside the
 * caller's applyCamera block. */
export function drawCenterMark(
  ctx: CanvasRenderingContext2D,
  p: Vec,
  zoom: number,
  color: string,
  size = 5,
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
  ctx.restore();
}
