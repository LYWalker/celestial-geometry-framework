/**
 * The pan/zoom math shared by every figure's canvas. This is formulas, not a
 * controller: each figure keeps its own Camera (its state object usually
 * already has zoom/pan/cx/cy fields — those satisfy this shape as-is) and
 * wires up its own pointerdown/move/up and wheel listeners, because that
 * wiring is where domain concerns live (does a drag clear a selection, does
 * a tap follow a body, what counts as a click vs a drag) — concerns this
 * module has no business deciding. What it gives you is the anchor-point
 * algebra: zoom in on the wheel, and the view holds still under the cursor.
 */

import type { Vec } from './geometry.js';

export interface Camera {
  zoom: number;
  pan: Vec;
  /** screen-space point the view pans and zooms around */
  cx: number;
  cy: number;
}

/** World point, relative to `ref`, to screen space under this camera. */
export function worldToScreen(p: Vec, ref: Vec, cam: Camera): Vec {
  return {
    x: (p.x - ref.x) * cam.zoom + cam.cx + cam.pan.x,
    y: (p.y - ref.y) * cam.zoom + cam.cy + cam.pan.y,
  };
}

/** Push the canvas context into this camera's world coordinates, centred on
 * `ref`. Pair with ctx.restore() once the figure's world-space drawing is done. */
export function applyCamera(ctx: CanvasRenderingContext2D, ref: Vec, cam: Camera): void {
  ctx.save();
  ctx.translate(cam.cx + cam.pan.x, cam.cy + cam.pan.y);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-ref.x, -ref.y);
}

/**
 * Zoom by `factor`, keeping the point (mx, my) fixed under the cursor — mx/my
 * are screen coordinates already measured from cam.cx/cam.cy, e.g.
 * `e.clientX - rect.left - cam.cx`. Call from a wheel handler.
 */
export function zoomAt(cam: Camera, mx: number, my: number, factor: number, min: number, max: number): void {
  const before = cam.zoom;
  cam.zoom = Math.max(min, Math.min(max, cam.zoom * factor));
  const k = cam.zoom / before;
  cam.pan.x = mx - (mx - cam.pan.x) * k;
  cam.pan.y = my - (my - cam.pan.y) * k;
}

/**
 * The two-finger equivalent of zoomAt: zoom by how the touches' spacing
 * changed since the last frame, pan by how their midpoint moved. `mid`/`mid0`
 * are this frame's and last frame's midpoints, already measured from cam.cx/cy.
 */
export function pinchAt(
  cam: Camera,
  mid: Vec,
  mid0: Vec,
  dist: number,
  dist0: number,
  min: number,
  max: number,
): void {
  const before = cam.zoom;
  cam.zoom = Math.max(min, Math.min(max, cam.zoom * (dist / dist0)));
  const k = cam.zoom / before;
  cam.pan.x = mid.x - (mid0.x - cam.pan.x) * k;
  cam.pan.y = mid.y - (mid0.y - cam.pan.y) * k;
}

export function panBy(cam: Camera, dx: number, dy: number): void {
  cam.pan.x += dx;
  cam.pan.y += dy;
}
