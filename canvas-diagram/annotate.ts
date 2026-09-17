/**
 * The angle-construction primitives: turn an arc from one longitude to
 * another about some centre, with an arrowhead for direction, and find where
 * to hang its name. This is the vocabulary a Rambam figure spends most of
 * its time speaking — "the course, turned from the apogee" is a sweep(); "5°
 * 8′ added to the mean" is a sweep() with a mark() beside it.
 */

import { DEG, norm360, polar, type Vec } from './geometry.js';

/** Below this screen-px arc width, the arrowhead is suppressed rather than
 * drawn illegibly small. */
const ARROWHEAD_MIN_ARC_PX = 10;
/** The arrowhead's own size, screen px (world px before the /zoom below). */
const ARROWHEAD_SIZE_PX = 5.5;

/** A small arrowhead with its tip at `tip`, pointing along `dir` (unit vector). */
export function arrowHead(ctx: CanvasRenderingContext2D, tip: Vec, dir: Vec, size: number): void {
  const n = { x: -dir.y, y: dir.x };
  ctx.beginPath();
  ctx.moveTo(tip.x - dir.x * size + n.x * size * 0.5, tip.y - dir.y * size + n.y * size * 0.5);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - dir.x * size - n.x * size * 0.5, tip.y - dir.y * size - n.y * size * 0.5);
  ctx.stroke();
}

/** The direction of travel round a circle at a given longitude, clockwise or not. */
export function tangent(lon: number, cw: boolean): Vec {
  const t = { x: -Math.sin(lon * DEG), y: -Math.cos(lon * DEG) };
  return cw ? { x: -t.x, y: -t.y } : t;
}

/**
 * An arc swept from one longitude to another, the way the sky turns unless
 * told otherwise (`cw`), with an arrowhead showing which way it went once
 * the arc is wide enough on screen to read. `zoom` is the camera's current
 * zoom — needed because the arrowhead is drawn in world units but should
 * stay a constant size on screen, and because whether it's worth drawing at
 * all depends on the arc's width in screen pixels, not world ones.
 */
export function sweep(
  ctx: CanvasRenderingContext2D,
  c: Vec,
  r: number,
  from: number,
  to: number,
  zoom: number,
  cw = false,
): void {
  const span = cw ? norm360(from - to) : norm360(to - from);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, -from * DEG, -to * DEG, !cw);
  ctx.stroke();
  if (r * zoom * span * DEG > ARROWHEAD_MIN_ARC_PX) {
    const p = polar(to, r);
    arrowHead(ctx, { x: c.x + p.x, y: c.y + p.y }, tangent(to, cw), ARROWHEAD_SIZE_PX / zoom);
  }
}

/** A signed angle goes the short way round — that is what "add" or "subtract"
 * means for a correction. Returns which way it went, for midOf() and for a
 * mark() that wants to know. */
export function sweepShort(
  ctx: CanvasRenderingContext2D,
  c: Vec,
  r: number,
  from: number,
  to: number,
  zoom: number,
): boolean {
  const cw = norm360(to - from) > 180;
  sweep(ctx, c, r, from, to, zoom, cw);
  return cw;
}

/** Where to hang an arc's name: the middle of its sweep. */
export function midOf(c: Vec, r: number, from: number, to: number, cw = false): Vec {
  const span = cw ? norm360(from - to) : norm360(to - from);
  const mid = cw ? from - span / 2 : from + span / 2;
  const o = polar(mid, r);
  return { x: c.x + o.x, y: c.y + o.y };
}
