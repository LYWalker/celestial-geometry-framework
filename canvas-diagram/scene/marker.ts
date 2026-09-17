/**
 * A reading on the ring: the short tick, and the dot on it, that says "this
 * is where that body stands against the mazalot."
 *
 * It exists as its own object because a reading is three things that have to
 * agree — a sightline out from somewhere, a tick across the band, and a name
 * — and what they have to agree about is not obvious. A *true* place is
 * sighted from the ring's own centre, so "the point at that longitude" and
 * "where the ray lands" are the same spot and nothing can drift. A *mean*
 * place is sighted from somewhere else: the sun's circle's own centre, the
 * moon's large circle's own centre. On a ring of finite radius those two
 * spots are not the same, and a figure that draws the line at the ray's
 * angle and the tick at the longitude's angle leaves them visibly apart
 * right at the ring — which is where the eye is, and which is what the
 * mean/true distinction is about. A RingMarker resolves that intersection
 * once (`rayToCircle`) and *is* the resulting point, so the line drawn `to`
 * it, the tick it draws, and the name it hangs are the same answer by
 * construction rather than three calculations that happen to match.
 *
 * It also knows what to do when its point is off screen — the usual case
 * once a figure is zoomed into the working rather than looking at the whole
 * dial. Rather than silently dropping the reading, it moves the name to the
 * edge of the frame in that direction and puts an arrowhead there: the
 * reading is still off that way, and the figure still says so.
 */

import { FULL_CIRCLE, clipToFrame, unit, type Vec } from '../geometry.js';
import {
  type DirectionLike,
  type Frame,
  type Meta,
  type PointLike,
  type Positioned,
  type Scalar,
  ORIGIN,
  SceneObject,
  rayToCircle,
  resolvePoint,
  resolveScalar,
} from './types.js';

export interface RingMarkerConfig extends Meta {
  /** the ring's own centre — the earth, in the Rambam figures. Default the origin. */
  center?: PointLike;
  /** the ring's radius, world px. Point it straight at a ZodiacRing's own
   * `inner` so the tick can never sit on a different circle than the one
   * that actually gets drawn. */
  radius: Scalar;
  /** where the sightline starts: the ring's centre for a true place, a
   * circle's own off-centre centre for a mean one. Defaults to `center`,
   * which is the true-place case. */
  pivot?: PointLike;
  /** the bearing from `pivot` — the longitude being read. */
  toward: DirectionLike;
  /**
   * `'solid'` (the default) — a filled dot, for a place the earth actually
   * sees. `'open'` — a ring, for a mean place: something in the
   * construction rather than in the sky. Deliberately a difference in kind
   * and not only in colour, since the two sit side by side on the same band
   * and the whole point of the pair is which is which.
   */
  style?: 'solid' | 'open';
  /** how far the tick reaches inside and outside the ring's inner edge,
   * world px. The default stops short of the band's own names. */
  reach?: { in: number; out: number };
  /** the dot's radius, world px before zoom. */
  dotSize?: number;
  lineWidth?: number;
}

const DEFAULT_REACH = { in: 7, out: 6 };
/** How far inside the frame a clipped name is placed, screen px. */
const EDGE_INSET = 24;
/** The edge arrowhead's half-width and length, screen px. */
const EDGE_ARROW = 5;

export class RingMarker extends SceneObject<RingMarkerConfig> implements Positioned {
  readonly kind = 'ringmarker' as const;

  private readonly point: Positioned;

  constructor(cfg: RingMarkerConfig) {
    super(cfg);
    this.point = rayToCircle(
      cfg.pivot ?? cfg.center ?? ORIGIN,
      cfg.toward,
      cfg.center ?? ORIGIN,
      cfg.radius,
    );
  }

  /** Where this reading lands on the ring — what the sightline should be
   * drawn `to`, so the line and the tick cannot disagree. */
  position(f: Frame): Vec {
    return this.point.position(f);
  }

  centerAt(f: Frame): Vec {
    return resolvePoint(this.cfg.center ?? ORIGIN, f);
  }

  /** The tick and its dot. World space; call inside the caller's camera
   * transform, like every other object's `draw`. */
  draw(ctx: CanvasRenderingContext2D, f: Frame, zoom: number, color: string): void {
    const p = this.position(f);
    const c = this.centerAt(f);
    const r = resolveScalar(this.cfg.radius, f);
    if (!(r > 0)) return;
    const d = unit({ x: p.x - c.x, y: p.y - c.y });
    const reach = this.cfg.reach ?? DEFAULT_REACH;
    const open = this.cfg.style === 'open';
    const lw = (this.cfg.lineWidth ?? (open ? 1.2 : 2)) / zoom;
    const dot = (this.cfg.dotSize ?? 3) / zoom;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(c.x + d.x * (r - reach.in), c.y + d.y * (r - reach.in));
    ctx.lineTo(c.x + d.x * (r + reach.out), c.y + d.y * (r + reach.out));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, dot, 0, FULL_CIRCLE);
    if (open) ctx.stroke();
    else ctx.fill();
    ctx.restore();
  }

  /** Screen-space points for hover hit-testing: the tick itself, which is a
   * far easier thing to put a pointer on than the dot alone. */
  hoverPts(f: Frame, toScreen: (p: Vec) => Vec): Vec[] {
    const p = this.position(f);
    const c = this.centerAt(f);
    const r = resolveScalar(this.cfg.radius, f);
    const d = unit({ x: p.x - c.x, y: p.y - c.y });
    const reach = this.cfg.reach ?? DEFAULT_REACH;
    return [
      toScreen({ x: c.x + d.x * (r - reach.in), y: c.y + d.y * (r - reach.in) }),
      toScreen({ x: c.x + d.x * (r + reach.out), y: c.y + d.y * (r + reach.out) }),
    ];
  }

  /**
   * Where to put this reading's name on screen: its own point when that is
   * in view, otherwise the edge of the frame in that direction. `dir` is
   * which way the name should sit from there — back toward the middle, so a
   * name pinned to the edge doesn't try to sit outside it.
   *
   * Returns null when there is no honest edge to pin anything to (the ring
   * lies off the frame in the opposite direction entirely).
   */
  labelPlacement(
    f: Frame,
    toScreen: (p: Vec) => Vec,
    bounds?: { width: number; safeBottom: number } | undefined,
  ): { x: number; y: number; dir: Vec; clipped: boolean } | null {
    const at = toScreen(this.position(f));
    const from = toScreen(this.centerAt(f));
    const outward = unit({ x: at.x - from.x, y: at.y - from.y });
    if (!bounds) return { x: at.x, y: at.y, dir: outward, clipped: false };
    const c = clipToFrame(from, at, EDGE_INSET, bounds.width, bounds.safeBottom);
    if (c.t <= 0.05) return null;
    // Un-clipped, the name belongs *outside* the reading, away from the
    // middle of the figure — the side the tick's own outer half points.
    // Clipped, it has nowhere to go but back inward.
    const inward = unit({ x: from.x - c.x, y: from.y - c.y });
    return { x: c.x, y: c.y, dir: c.clipped ? inward : outward, clipped: c.clipped };
  }

  /** The arrowhead that stands in for a reading whose own point is off
   * screen — "it is still that way." Screen space: call after the camera
   * transform has been undone. */
  drawEdgeArrow(ctx: CanvasRenderingContext2D, at: Vec, inward: Vec, color: string, alpha: number): void {
    const o = { x: -inward.x, y: -inward.y };
    const n = { x: -o.y, y: o.x };
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(at.x + o.x * (EDGE_ARROW + 2), at.y + o.y * (EDGE_ARROW + 2));
    ctx.lineTo(at.x - o.x * 3 + n.x * EDGE_ARROW, at.y - o.y * 3 + n.y * EDGE_ARROW);
    ctx.lineTo(at.x - o.x * 3 - n.x * EDGE_ARROW, at.y - o.y * 3 - n.y * EDGE_ARROW);
    ctx.closePath();
    if (this.cfg.style === 'open') ctx.stroke();
    else ctx.fill();
    ctx.restore();
  }
}
