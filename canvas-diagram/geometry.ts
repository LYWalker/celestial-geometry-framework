/**
 * Pure 2D geometry shared by every canvas figure built on this kit: points,
 * angles, distances, and the sampled polylines annotate.ts and hover.ts are
 * built on. Nothing here touches a canvas context or knows what it's for.
 */

export type Vec = { x: number; y: number };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEG = Math.PI / 180;

/** A full circle for ctx.arc()'s end angle — any value > 2π closes the
 * path; 7 is this codebase's idiom (used throughout, including Orrery.astro
 * directly). Kept here as a name for new code to reach for. */
export const FULL_CIRCLE = 7;

/** Wrap an angle (or anything periodic in 360) into [0, 360). */
export const norm360 = (x: number): number => ((x % 360) + 360) % 360;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** A compass direction at longitude `lon` (degrees), radius `r`, as a canvas
 * vector — y flipped, since longitude runs anticlockwise but canvas y is down. */
export const polar = (lon: number, r: number): Vec => ({
  x: r * Math.cos(lon * DEG),
  y: -r * Math.sin(lon * DEG),
});

/** The compass direction of a vector, inverting polar(). */
export const lonOf = (v: Vec): number => norm360(Math.atan2(-v.y, v.x) / DEG);

export const unit = (v: Vec): Vec => {
  const n = Math.hypot(v.x, v.y);
  return n < 1e-9 ? { x: 1, y: 0 } : { x: v.x / n, y: v.y / n };
};

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;

/** Shortest distance from p to the segment ab. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance from p to a polyline — or, for a single point, to that point. */
export function distToPolyline(p: Vec, pts: Vec[]): number {
  // The `!`s below are both guaranteed by the surrounding bounds check, not
  // hopeful casts: length === 1 guarantees index 0 exists, and the loop
  // condition (i < pts.length - 1) guarantees i + 1 is always in range —
  // noUncheckedIndexedAccess just can't see either invariant from here.
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(p, pts[i]!, pts[i + 1]!));
  return best;
}

/** Points sampled along an arc from `from` to `to` (degrees) about centre c,
 * the short or long way per `cw` — the same sweep annotate.ts's sweep() draws.
 * Handed to a hover registration as the arc's hoverable/highlightable shape. */
export function arcPts(c: Vec, r: number, from: number, to: number, cw = false, n = 16): Vec[] {
  const span = cw ? norm360(from - to) : norm360(to - from);
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + (cw ? -1 : 1) * ((span * i) / n);
    const p = polar(t, r);
    pts.push({ x: c.x + p.x, y: c.y + p.y });
  }
  return pts;
}

/**
 * A plane tipped out of the page, seen from a fixed viewpoint square-on to
 * the page. Two numbers say everything: how far it is tipped, and about
 * which line.
 *
 * That line — the *line of nodes*, where the tilted plane crosses the flat
 * one — is the only direction in which nothing is foreshortened, which is
 * why it is the natural thing to state a tilt about rather than an arbitrary
 * axis. In the sky it is also the thing that matters: the moon is on the
 * ecliptic only at its nodes, so eclipses happen there and nowhere else.
 */
export interface TiltedPlane {
  /** how far the plane is tipped out of the page, degrees */
  tilt: number;
  /** the compass bearing of the line of nodes */
  nodes: number;
}

/** Where a point on a tilted plane lands on the page, and how far out of the
 * page it stands. */
export interface PlanePoint extends Vec {
  /** signed distance from the flat plane, in the same units as `r`:
   * positive toward the viewer, negative away. Zero exactly at the nodes.
   *
   * Not a drawing trick — this is the real quantity. For an orbit inclined
   * `tilt` to the ecliptic, `lon` counted from the ascending node is the
   * argument of latitude, and `depth` is `r·sin(β)`, the body's height above
   * the ecliptic plane. A figure can print it, or drop a perpendicular to
   * the flat plane and be drawing the truth rather than an impression.
   */
  depth: number;
}

/**
 * A point at bearing `lon` and distance `r` from a tilted plane's centre, as
 * it projects onto the page.
 *
 * `lon` is measured *within the tilted plane itself*, from the same zero
 * bearing the flat plane uses. The projected bearing that comes back out is
 * therefore not `lon` — it satisfies tan(λ − Ω) = tan(lon − Ω)·cos(tilt),
 * which is exactly the relation between a body's argument of latitude and
 * its ecliptic longitude. The discrepancy is not an artefact to be corrected
 * for; in an inclination figure it is the subject.
 */
export function onPlane(lon: number, r: number, plane: TiltedPlane): PlanePoint {
  const a = (lon - plane.nodes) * DEG;
  const t = plane.tilt * DEG;
  // in the plane's own frame: along the node line, and across it
  const along = r * Math.cos(a);
  const across = r * Math.sin(a);
  // tipping about the node line foreshortens only the across-component, and
  // is the entire reason anything leaves the page at all
  const flatAcross = across * Math.cos(t);
  const u = polar(plane.nodes, 1);
  // the node line's perpendicular, a quarter turn anticlockwise from it in
  // the same y-flipped convention polar() uses. Getting this the other way
  // round mirrors the plane about its own node line: harmless-looking, and
  // it puts the body south of the flat plane exactly when it should be north.
  const w = polar(plane.nodes + 90, 1);
  return {
    x: along * u.x + flatAcross * w.x,
    y: along * u.y + flatAcross * w.y,
    depth: across * Math.sin(t),
  };
}

/** Points sampled along a tilted circle, from `from` to `to` (degrees,
 * measured in the plane), as they project onto the page. A tilted circle is
 * an ellipse and `ctx.arc` cannot draw it, so every planed ring in this kit
 * — drawn, hovered or highlighted — comes from here. */
export function planeArcPts(
  c: Vec,
  r: number,
  plane: TiltedPlane,
  from = 0,
  to = 360,
  n = 64,
): PlanePoint[] {
  const pts: PlanePoint[] = [];
  // n = 0 is a legitimate ask — "just the point at `from`" — and dividing
  // by it would hand back NaN, which propagates silently into a label's
  // direction or a hover zone long after the call that caused it.
  const step = n > 0 ? (to - from) / n : 0;
  for (let i = 0; i <= n; i++) {
    const p = onPlane(from + step * i, r, plane);
    pts.push({ x: c.x + p.x, y: c.y + p.y, depth: p.depth });
  }
  return pts;
}

/** Points sampled all the way round a circle — for hover-testing or highlighting its rim. */
export function circlePts(c: Vec, r: number, n = 32): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const p = polar((360 * i) / n, r);
    pts.push({ x: c.x + p.x, y: c.y + p.y });
  }
  return pts;
}

/**
 * Clip a screen-space ray from `from` toward `to` to a rectangular frame,
 * inset a little from its edges (and from `safeBottom`, where a caption
 * strip or similar lives). `t` is how far along the ray it got; `clipped` is
 * whether it left the frame before reaching `to`.
 */
export function clipToFrame(
  from: Vec,
  to: Vec,
  inset: number,
  width: number,
  safeBottom: number,
  bottomInset = 14,
): Vec & { t: number; clipped: boolean } {
  const xmin = inset;
  const xmax = width - inset;
  const ymin = inset;
  const ymax = safeBottom - bottomInset;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (xmax - from.x) / dx);
  else if (dx < 0) t = Math.min(t, (xmin - from.x) / dx);
  if (dy > 0) t = Math.min(t, (ymax - from.y) / dy);
  else if (dy < 0) t = Math.min(t, (ymin - from.y) / dy);
  t = clamp(t, 0, 1);
  return { x: from.x + dx * t, y: from.y + dy * t, t, clipped: t < 1 };
}
