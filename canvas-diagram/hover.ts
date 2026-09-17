/**
 * "Hover a line and it explains itself" — the three pieces of that which
 * don't change from one figure to the next: matching the pointer against
 * whatever was drawn this frame, driving a DOM tooltip that follows it, and
 * drawing the highlight for whatever matched. What a figure still has to do
 * itself is call mark() once for every point/line/arc it draws, alongside
 * however it builds its own Label list — the two are usually the same call.
 */

import { distToPolyline, FULL_CIRCLE, type Vec } from './geometry';

/** update()'s default proximity threshold, screen px. */
export const HOVER_THRESHOLD_PX = 12;

/** Catmull-Rom through `pts`, as cubic Béziers — the same curve shape
 * scene/trail.ts's own smoothSegment draws (kept as a separate, plain-Vec[]
 * copy here rather than imported, since scene/trail.ts is built on this
 * module and importing it back the other way would invert that dependency). */
function traceSmoothCurve(ctx: CanvasRenderingContext2D, pts: Vec[]): void {
  const n = pts.length;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
}

export interface HoverZone {
  /** unique across the whole figure — pairing text with colour is enough to
   * disambiguate two elements that happen to share a name (e.g. the same
   * construction repeated for two different bodies in different colours) */
  id: string;
  text: string;
  sub: string;
  colour: string;
  /** screen-space points; a single point degenerates the hit-test to a
   * circle. Ignored when `circle` is set. */
  pts: Vec[];
  /** an exact circle hit-test and highlight, set by markCircle() — cheaper
   * and more accurate than approximating a ring with points in `pts` */
  circle?: { c: Vec; r: number };
  /** the same shape as `pts`, at full resolution, for a target whose hit-test
   * polyline is deliberately coarser than what's actually drawn — a trail's
   * `pts` only needs to be dense enough to hit-test against, but tracing the
   * highlight along it would visibly cut every corner the trail's own
   * Catmull-Rom curve doesn't. Set only by a caller whose drawn shape is a
   * curve through more points than its hit-test needs; drawHighlight() draws
   * along this instead of `pts` when present. */
  curvePts?: Vec[];
}

export interface HoverTooltipEls {
  root: HTMLElement;
  text: HTMLElement;
  sub: HTMLElement;
}

export class HoverController {
  private zones: HoverZone[] = [];
  hoverId: string | null = null;
  hoverZone: HoverZone | null = null;

  constructor(private tip: HoverTooltipEls) {}

  /** Call once at the start of each frame, before mark()ing anything. */
  begin(): void {
    this.zones = [];
  }

  /** Register a hoverable point/line/arc this frame. Returns whether it's
   * the one currently under the pointer (from *last* frame's update()), so
   * the caller can brighten it while drawing without waiting a frame.
   *
   * `id` disambiguates zones that would otherwise collide: the default,
   * `text|colour`, is enough when a figure never hovers two differently-
   * shaped things that happen to share both a name and a colour (a ring and
   * the body riding it, say) — pass an explicit `id` when it might. */
  mark(pts: Vec[], text: string, sub: string, colour: string, id?: string, curvePts?: Vec[]): boolean {
    const zoneId = id ?? `${text}|${colour}`;
    this.zones.push({ id: zoneId, text, sub, colour, pts, curvePts });
    return this.hoverId === zoneId;
  }

  /** Register a hoverable ring/circle this frame with an exact analytic
   * hit-test and highlight, instead of approximating it with points in
   * `pts` the way mark() would need to — cheaper (no polygon to build or
   * walk) and, at high zoom, visibly more accurate against the drawn arc. */
  markCircle(c: Vec, r: number, text: string, sub: string, colour: string, id?: string): boolean {
    const zoneId = id ?? `${text}|${colour}`;
    this.zones.push({ id: zoneId, text, sub, colour, pts: [c], circle: { c, r } });
    return this.hoverId === zoneId;
  }

  /** Call once per frame with the pointer's canvas-local position, or null
   * while it's off the canvas or a drag/pinch is in progress. Updates the
   * tooltip immediately and returns the matched zone (or null). */
  update(pointer: Vec | null, threshold = HOVER_THRESHOLD_PX): HoverZone | null {
    let best: HoverZone | null = null;
    let bestDist = threshold;
    if (pointer) {
      for (const z of this.zones) {
        const d = z.circle
          ? Math.abs(Math.hypot(pointer.x - z.circle.c.x, pointer.y - z.circle.c.y) - z.circle.r)
          : distToPolyline(pointer, z.pts);
        if (d < bestDist) {
          bestDist = d;
          best = z;
        }
      }
    }
    this.hoverId = best?.id ?? null;
    this.hoverZone = best;
    if (best && pointer) {
      this.tip.root.hidden = false;
      this.tip.text.textContent = best.text;
      this.tip.sub.textContent = best.sub;
      this.tip.root.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
    } else {
      this.tip.root.hidden = true;
    }
    return best;
  }

  /** Draw a glow round whatever matched this frame's update() — a ring for a
   * point, a bright retrace for a line or arc. Call last, in plain screen
   * space (after any ctx.restore() that undoes the world-space camera transform). */
  drawHighlight(ctx: CanvasRenderingContext2D, glowColour: string): void {
    const hot = this.zones.find((z) => z.id === this.hoverId);
    if (!hot) return;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = glowColour;
    ctx.shadowColor = hot.colour;
    ctx.shadowBlur = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (hot.circle) {
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(hot.circle.c.x, hot.circle.c.y, hot.circle.r, 0, FULL_CIRCLE);
      ctx.stroke();
    } else if (hot.pts.length === 1) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hot.pts[0].x, hot.pts[0].y, 7, 0, 7);
      ctx.stroke();
    } else if (hot.curvePts && hot.curvePts.length > 1) {
      // A trail is already drawn, faded, across a good stretch of the
      // screen — the full point/line glow below would double up on that
      // and read as gaudy, so this stays softer: less blur, less alpha.
      ctx.globalAlpha = 0.5;
      ctx.shadowBlur = 4;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      traceSmoothCurve(ctx, hot.curvePts);
      ctx.stroke();
    } else {
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      hot.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.restore();
  }
}
