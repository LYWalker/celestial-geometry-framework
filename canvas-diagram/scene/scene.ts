/**
 * The container an author actually builds a diagram from: add() the objects
 * — Spheres, Anchors, Angles, Connectors, Trails — once, in whatever order
 * makes the construction easy to read in the source (draw order is decided
 * separately, by `layer`), and draw() every frame with a Frame and a camera.
 * It paints each object with a sensible default (a ring for a sphere, a dot
 * for what rides it, an arc with an arrowhead for an angle, a line for a
 * connector, a fading tail for a trail), registers every one of them with a
 * HoverController if given one, and hands back the Label[] this kit's
 * collision-avoiding drawLabels() lays out — so "hover it and it explains
 * itself" and "name what there's room to name" both come for free from
 * declaring the objects, never from a figure re-deriving them.
 *
 * Draw happens in two passes. World-space geometry — rings, centre marks,
 * connectors, angle arcs, trails — is drawn first, inside one camera
 * transform. Bodies (a Sphere's carried point) are drawn second, *after*
 * that transform is undone, in plain screen pixels: a lit sphere's
 * gradient, a ring's tilt, a terminator's clip all assume screen-space
 * units, and would scale wrongly under a zoomed-in transform.
 */

import { FULL_CIRCLE, sub, unit, type PlanePoint, type Vec } from '../geometry.js';
import { applyCamera, worldToScreen, type Camera } from '../camera.js';
import type { Face, Label, LabelTheme } from '../labels.js';
import type { HoverController } from '../hover.js';
import { Sphere } from './sphere.js';
import { Angle } from './angle.js';
import { Connector, drawCenterMark } from './connector.js';
import { Anchor } from './anchor.js';
import { Trail } from './trail.js';
import { RingMarker } from './marker.js';
import {
  type BodyRenderContext,
  type BodyRenderer,
  type Frame,
  type Meta,
  type PointLike,
  ORIGIN,
  resolveBool,
  resolveDirection,
  resolveLabelDir,
  resolvePoint,
  resolveScalar,
  resolveText,
} from './types.js';

export type SceneItem = Sphere | Angle | Connector | Anchor | Trail | RingMarker;

function assertNever(x: never): never {
  throw new Error(`canvas-diagram scene: unhandled item kind "${(x as SceneItem).kind}"`);
}

/** The numeric scale `Meta.layer` breaks out of — lower draws first. */
export const LAYER = {
  shell: 0,
  trail: 5,
  anchor: 8,
  connector: 10,
  angle: 20,
  /** a reading on the ring sits above the lines that reach it */
  marker: 25,
  body: 30,
} as const;

/**
 * Where a Trail's points hang in world space: its own `relativeTo`, resolved
 * at the current instant (the origin for a trail plotted in raw world
 * space). Every sample is stored as `target(t) - relativeTo(t)` — a shape,
 * not a place — so to draw it, or measure it, that shape is pinned back onto
 * the point it was reduced against, as that point stands *now*. This is
 * deliberately not the draw call's `ref`: the two coincide for the common
 * case of a trail drawn in the frame the camera holds still, but the moment a
 * figure follows something else (clicking a planet to centre on it), a ref
 * that stood in for the anchor would slide the whole trail off the body it
 * belongs to by the distance between them.
 */
function trailAnchor(item: Trail, f: Frame): Vec {
  return item.cfg.relativeTo === undefined ? { x: 0, y: 0 } : resolvePoint(item.cfg.relativeTo, f);
}

function layerOf(item: SceneItem): number {
  if (item.cfg.layer !== undefined) return item.cfg.layer;
  switch (item.kind) {
    case 'trail':
      return LAYER.trail;
    case 'anchor':
      return LAYER.anchor;
    case 'sphere':
      return item.showBody ? LAYER.body : LAYER.shell;
    case 'connector':
      return LAYER.connector;
    case 'angle':
      return LAYER.angle;
    case 'ringmarker':
      return LAYER.marker;
    default:
      return assertNever(item);
  }
}

/** How much of its own opacity the half of a tilted rim that is behind the
 * flat plane keeps. Enough to stay legible as a continuing line, little
 * enough that which half is in front is never in question. */
const DEFAULT_BEHIND_FADE = 0.4;

const defaultBodyRenderer: BodyRenderer = (ctx, b) => {
  ctx.globalAlpha = b.alpha;
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.arc(b.screen.x, b.screen.y, b.r, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.globalAlpha = 1;
};

/** Fallback colors and fonts for any object that doesn't set its own —
 * extends LabelTheme so the same object can be passed straight to drawLabels(). */
export interface SceneTheme extends LabelTheme {
  ring: string;
  body: string;
  centerMark: string;
  angle: string;
  connector: string;
  trail: string;
  activeFont: Face;
  /** the face a Hebrew headline is set in, for an object with
   * `hebrewFirst` (see Meta). Falls back to `subFont`, which is already the
   * figure's Hebrew face. */
  nameFont?: Face;
  /** the face an English headline is set in when `hebrewFirst` is asked for
   * but the object has no Hebrew name — a point the text implies but never
   * names. Deliberately a different face from `nameFont`, so a name he
   * gives and a name he doesn't never read as the same kind of thing.
   * Falls back to `font`. */
  inferredFont?: Face;
}

/** What a label says and what it's set in, for one object — the single
 * place the `hebrewFirst`/`gloss`/`nameHe` rules live, rather than four
 * copies of them across the `switch` in draw(). */
function labelStyle(m: Meta, theme: SceneTheme, active: boolean, f: Frame) {
  const gloss = resolveText(m.gloss, f);
  if (m.hebrewFirst) {
    // A construction: the Hebrew name is the headline, because in these
    // figures the names carry the argument, and the gloss explains it
    // beneath. A point with no Hebrew name is one he never named — English
    // headline, in its own face, so the two never blur.
    return {
      text: m.nameHe ?? m.name,
      sub: gloss,
      font:
        m.labelFont ??
        (m.nameHe ? (theme.nameFont ?? theme.subFont) : (theme.inferredFont ?? theme.font)),
      subFont: m.labelSubFont ?? theme.noteFont,
    };
  }
  // A body: English headline, Hebrew beneath — the ordinary case.
  return {
    text: m.name,
    sub: gloss ?? m.nameHe,
    font: m.labelFont ?? (active ? theme.activeFont : theme.font),
    subFont: m.labelSubFont ?? theme.subFont,
  };
}

export interface SceneDrawOptions {
  ctx: CanvasRenderingContext2D;
  /** this draw call's moment — the diagram's clock plus whatever other
   * named UI state its Scalars read from */
  f: Frame;
  /** the point the camera holds still */
  ref: PointLike;
  camera: Camera;
  theme: SceneTheme;
  // The four fields below are widened to `| undefined` (not just an
  // omittable key) under exactOptionalPropertyTypes: Stage.render() passes
  // all of `opts.hover`/`lightSource`/`showLabels`/etc straight through from
  // its own identically-optional fields, `undefined` included, rather than
  // conditionally spreading each one away — this call happens once a frame
  // and building a second object shape to omit possibly-absent keys would
  // cost more than the widening does.
  hover?: HoverController | undefined;
  /** where the light comes from, for any Sphere with a custom `render` that
   * wants a lit hemisphere — resolved once per draw call and handed to
   * every body renderer as a screen-space unit vector */
  lightSource?: PointLike | undefined;
  /** name what can be named. Default true. */
  showLabels?: boolean | undefined;
  /** draw Angles and Connectors (and a Sphere's centre mark). Default true
   * — turn off for the plain picture without the working shown. */
  showConstruction?: boolean | undefined;
  /** draw sphere rings themselves. Default true — turn off to show only the
   * bodies riding them. */
  showRings?: boolean | undefined;
  /** the visible frame, screen px — what a RingMarker whose own point has
   * gone off screen pins its name to instead of dropping it. Omit for a
   * figure that would rather such a name simply be laid out at its own
   * (off-screen, and so discarded) point. Stage.render() passes its own. */
  bounds?: { width: number; safeBottom: number } | undefined;
}

export class Scene {
  private items: SceneItem[] = [];
  private byId = new Map<string, SceneItem>();
  /** the layer-sorted draw order, cached across frames since `layer` is
   * ordinary config, not a Scalar — recomputed only when add()/remove()
   * change the set, or invalidateOrder() is called explicitly */
  private ordered: SceneItem[] | null = null;
  private warnedIds = new Set<string>();

  add(item: SceneItem): this {
    if (this.byId.has(item.id))
      throw new Error(`canvas-diagram scene: an object with id "${item.id}" was already added`);
    this.byId.set(item.id, item);
    this.items.push(item);
    this.ordered = null;
    return this;
  }

  /** Remove a previously-added object (a mode that swaps out its objects
   * rather than fading them via `opacity`). Returns whether it was there. */
  remove(id: string): boolean {
    const item = this.byId.get(id);
    if (!item) return false;
    this.byId.delete(id);
    const i = this.items.indexOf(item);
    if (i !== -1) this.items.splice(i, 1);
    this.ordered = null;
    return true;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Fetch a previously-added object by id, to reference it while building
   * another (`center: scene.get('earth')`) or to read it out for a readout
   * panel. Pass the expected `kind` to get it back narrowed *and* checked at
   * runtime — `scene.get('earth', 'anchor')` throws if `'earth'` turns out
   * to be something else, instead of handing back a value whose type is a
   * promise nothing checks. Throws on an unknown id either way — a typo here
   * should fail loudly, not hand back `undefined` for a later call to choke on. */
  get(id: string): SceneItem;
  get<K extends SceneItem['kind']>(id: string, kind: K): Extract<SceneItem, { kind: K }>;
  get(id: string, kind?: SceneItem['kind']): SceneItem {
    const found = this.byId.get(id);
    if (!found) throw new Error(`canvas-diagram scene: no object with id "${id}"`);
    if (kind !== undefined && found.kind !== kind)
      throw new Error(`canvas-diagram scene: "${id}" is a ${found.kind}, not a ${kind}`);
    return found;
  }

  all(): readonly SceneItem[] {
    return this.items;
  }

  /** Call after mutating an already-added item's `cfg.layer` — draw()'s
   * sorted order is otherwise cached across frames and won't notice. */
  invalidateOrder(): void {
    this.ordered = null;
  }

  /** Throw away every object's per-Frame memo (Sphere's resolved centre and
   * radius, Angle's sweep, Connector's endpoints), so the next read
   * re-derives them even within the Frame they were cached under — the
   * bulk form of each object's own `invalidate()`, for something that
   * changes what they resolve to *mid-frame*. `extent()` uses it: measuring
   * the scene resolves objects at a moment when anything sized from the
   * measurement itself (an auto-sized ring, and the dial lines drawn out to
   * it) deliberately reads as zero, and those provisional answers must not
   * be the ones the same frame then draws. */
  invalidateResolved(): void {
    for (const item of this.items) {
      if ('invalidate' in item) item.invalidate();
    }
  }

  /**
   * How far the scene reaches from a point, right now — the world-px radius
   * of the smallest circle centred on `center` that contains everything
   * drawn: a Sphere's whole ring and the body riding it, an Angle's arc,
   * both ends of a Connector, every sample of a Trail, and an Anchor that
   * has a marker of its own. Anything currently faded out via `opacity`,
   * and an Anchor with `marker: 'none'` (a reference point that's never
   * drawn), are left out — the question this answers is "how much room does
   * the picture need," not "where could something be." So is anything
   * marked `excludeFromExtent` (see Meta), for a sightline drawn out to
   * whatever this measurement itself sizes.
   *
   * Stage's zodiac ring sizes itself with this (see `ZodiacConfig.radius`);
   * a figure can call it directly for its own `resize({ fitRadius })`.
   *
   * Returns 0 for an empty scene (or one with nothing visible). It takes no
   * `ref`: a Trail's samples are put back into world space through the
   * trail's own `relativeTo` (see the `trail` case below), which is the
   * point they were reduced against in the first place — the draw call's
   * recentring never enters into it.
   *
   * Resolved fresh per call, like everything else here: for a scene whose
   * outermost object *moves*, the answer moves with it. A caller that wants
   * a ring that doesn't breathe should size it from geometry that doesn't
   * either — a fixed outermost shell — or cache the value itself.
   */
  extent(f: Frame, opts: { center?: PointLike } = {}): number {
    const center = resolvePoint(opts.center ?? ORIGIN, f);
    let max = 0;
    const reach = (p: Vec, pad = 0) => {
      const d = Math.hypot(p.x - center.x, p.y - center.y) + pad;
      // Non-finite geometry is draw()'s problem to warn about (checkFinite)
      // — here it must simply not poison the answer with NaN.
      if (Number.isFinite(d) && d > max) max = d;
    };

    for (const item of this.items) {
      if (item.cfg.excludeFromExtent) continue;
      if (resolveScalar(item.cfg.opacity ?? 1, f) <= 0.003) continue;
      switch (item.kind) {
        case 'sphere':
          if (item.showRing) reach(item.centerAt(f), item.radiusAt(f));
          if (item.showBody) reach(item.position(f));
          break;
        case 'anchor':
          if ((item.cfg.marker ?? 'cross') !== 'none') reach(item.position(f));
          break;
        case 'connector':
          reach(item.fromAt(f));
          reach(item.toAt(f));
          break;
        case 'angle':
          reach(item.vertexAt(f), item.radiusAt(f));
          break;
        case 'trail': {
          // points() are relative to the trail's own `relativeTo`, already
          // recentred (see Trail.points) — put them back into the same
          // world space `center` lives in, through that same point resolved
          // at the current instant, before measuring.
          const anchor = trailAnchor(item, f);
          for (const p of item.points(f)) reach({ x: p.x + anchor.x, y: p.y + anchor.y });
          break;
        }
        case 'ringmarker':
          // Never measured, whatever it says about `excludeFromExtent`: a
          // reading sits *on* the ring, and an auto-sized ring is sized from
          // this very measurement. Counting it would put the ring outside
          // itself, and again the frame after that.
          break;
        default:
          assertNever(item);
      }
    }
    return max;
  }

  private checkFinite(id: string, ...points: Vec[]): boolean {
    const bad = points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y));
    if (bad && !this.warnedIds.has(id)) {
      this.warnedIds.add(id);
      console.warn(
        `canvas-diagram scene: "${id}" resolved to a non-finite position — check for a Frame key ` +
          `that doesn't exist (a typo'd \`f.someKey\` reads as undefined, and undefined * anything is NaN) ` +
          `or a Scalar/PointLike that divides by zero. Skipped until fixed; this won't warn again for it.`,
      );
    }
    return bad;
  }

  /** Which object (if any) is under a screen point — for a click handler
   * that wants "what did they hit" without re-deriving worldToScreen()
   * per object itself. Tests each object's single representative point
   * (a Sphere's carried body, an Anchor with a drawn marker, an Angle's
   * midpoint, a Connector's midpoint); bare shells, an Anchor with
   * `marker: 'none'`, and Trails have no one point and are skipped — as is
   * anything currently faded to invisible via `opacity`. */
  hitTest(screenPt: Vec, opts: { f: Frame; ref: PointLike; camera: Camera; threshold?: number }): SceneItem | null {
    const ref = resolvePoint(opts.ref, opts.f);
    const toScreen = (p: Vec) => worldToScreen(p, ref, opts.camera);
    const threshold = opts.threshold ?? 14;
    let best: SceneItem | null = null;
    let bestDist = threshold;

    for (const item of this.items) {
      if (resolveScalar(item.cfg.opacity ?? 1, opts.f) <= 0.003) continue;
      let p: Vec | null = null;
      switch (item.kind) {
        case 'sphere':
          if (item.showBody) p = item.position(opts.f);
          break;
        case 'anchor':
          if ((item.cfg.marker ?? 'cross') !== 'none') p = item.position(opts.f);
          break;
        case 'angle':
          p = item.midAt(opts.f);
          break;
        case 'connector': {
          const a = item.fromAt(opts.f);
          const b = item.toAt(opts.f);
          p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          break;
        }
        case 'ringmarker':
          p = item.position(opts.f);
          break;
        case 'trail':
          break;
        default:
          assertNever(item);
      }
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const s = toScreen(p);
      const d = Math.hypot(s.x - screenPt.x, s.y - screenPt.y);
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  draw(opts: SceneDrawOptions): Label[] {
    const { ctx, f, camera, theme, hover } = opts;
    const showLabels = opts.showLabels ?? true;
    const showConstruction = opts.showConstruction ?? true;
    const showRings = opts.showRings ?? true;
    const bounds = opts.bounds;
    const ref = resolvePoint(opts.ref, f);
    const toScreen = (p: Vec) => worldToScreen(p, ref, camera);
    // A Trail's own points are already relative to *its* `relativeTo` (see
    // trail.ts), re-resolved at each sample's own past moment. Screen-mapping
    // them through `ref` the way every other kind's raw world coordinates
    // need would subtract a point they've already had subtracted; instead
    // they're pinned back onto their anchor as it stands now (trailAnchor)
    // and mapped from there, which leaves them under `ref` exactly like
    // everything else — including when `ref` is some *other* body the camera
    // is following, where anchor and ref part company.
    const toScreenTrail = (anchor: Vec) => (p: Vec) =>
      worldToScreen({ x: p.x + anchor.x, y: p.y + anchor.y }, ref, camera);
    const labels: Label[] = [];
    const pendingBodies: (() => void)[] = [];
    // Screen-space furniture that has to wait for the camera transform to be
    // undone - a RingMarker's off-frame arrowhead, pinned to the edge of the
    // canvas and so not in world space at all.
    const pendingOverlay: (() => void)[] = [];
    // Respected, not clobbered: a caller may have set ctx.globalAlpha for a
    // whole-scene crossfade before calling draw() — every per-item alpha
    // below multiplies this in, and every reset restores it rather than a
    // bare 1, so drawing after the first item that touches alpha still
    // sees the caller's own value.
    const ambientAlpha = ctx.globalAlpha;

    hover?.begin();
    const lightScreen = opts.lightSource !== undefined ? toScreen(resolvePoint(opts.lightSource, f)) : undefined;
    this.ordered ??= [...this.items].sort((a, b) => layerOf(a) - layerOf(b));
    // the hover tooltip's second line is the description, not the label's
    // Hebrew sub-line — the two are separate channels (see Meta)
    const hoverSub = (m: { nameHe?: string; description?: string }) => m.description ?? m.nameHe ?? '';

    try {
      applyCamera(ctx, ref, camera);
      ctx.lineWidth = 1 / camera.zoom;

      for (const item of this.ordered) {
        const opacity = resolveScalar(item.cfg.opacity ?? 1, f);
        if (opacity <= 0.003) continue;

        switch (item.kind) {
          case 'sphere': {
            const c = item.centerAt(f);
            const r = item.radiusAt(f);
            if (this.checkFinite(item.id, c)) break;
            const color = item.cfg.color ?? theme.ring;

            if (item.showRing && showRings) {
              const plane = item.planeAt(f);
              ctx.globalAlpha = opacity * ambientAlpha;
              ctx.strokeStyle = color;
              if (!plane) {
                ctx.beginPath();
                ctx.arc(c.x, c.y, r, 0, FULL_CIRCLE);
                ctx.stroke();
                // An exact analytic hover zone (not a 32-gon approximation),
                // and registered unconditionally now — the sun's own eccentric
                // circle is exactly the kind of line a figure most wants
                // hoverable, and its `:ring`/`:body` ids no longer collide.
                hover?.markCircle(toScreen(c), r * camera.zoom, item.name, hoverSub(item.cfg), color, `${item.id}:ring`);
              } else {
                // A tilted rim is an ellipse, which ctx.arc cannot draw, so
                // it is sampled — and split at the nodes, which is exactly
                // where it crosses the flat plane. The half behind is drawn
                // fainter and first, so the two halves cross each other the
                // right way round and the tilt reads as a tilt rather than
                // as a squashed circle.
                //
                // Both halves are drawn before the bodies, like any other
                // ring: a rim centred on a body never comes closer to it
                // than r*cos(tilt), so there is nothing to hide behind.
                // A figure whose tilt is steep enough for that to stop being
                // true can say so with `layer`.
                const half = 180;
                const a = item.rimAt(f, plane.nodes, plane.nodes + half, 48);
                const b = item.rimAt(f, plane.nodes + half, plane.nodes + 2 * half, 48);
                const aIsNear = (a[a.length >> 1]?.depth ?? 0) >= 0;
                const near = aIsNear ? a : b;
                const far = aIsNear ? b : a;
                const behind = item.cfg.plane?.behindFade ?? DEFAULT_BEHIND_FADE;
                const stroke = (pts: PlanePoint[], alpha: number) => {
                  ctx.globalAlpha = alpha;
                  ctx.beginPath();
                  // pts is never empty: rimAt always returns n + 1 points.
                  ctx.moveTo(pts[0]!.x, pts[0]!.y);
                  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
                  ctx.stroke();
                };
                stroke(far, opacity * ambientAlpha * behind);
                stroke(near, opacity * ambientAlpha);
                hover?.mark(
                  [...far, ...near].map(toScreen),
                  item.name,
                  hoverSub(item.cfg),
                  color,
                  `${item.id}:ring`,
                );
              }
              ctx.globalAlpha = ambientAlpha;
            }
            if (showConstruction && resolveBool(item.cfg.markCenter, f)) {
              ctx.globalAlpha = opacity * ambientAlpha;
              drawCenterMark(ctx, c, camera.zoom, item.cfg.color ?? theme.centerMark);
              ctx.globalAlpha = ambientAlpha;
            }

            if (!item.showBody) {
              if (showLabels && (item.cfg.showLabel ?? true) && item.cfg.labelAt !== undefined) {
                const dir = resolveDirection(item.cfg.labelAt, c, f);
                // on the rim as drawn, which for a tilted sphere is not
                // where polar(dir, r) would put it
                const on = item.rimAt(f, dir, dir, 0)[0]!;
                const at = toScreen(on);
                const st = labelStyle(item.cfg, theme, false, f);
                labels.push({
                  text: st.text,
                  sub: st.sub,
                  x: at.x,
                  y: at.y,
                  dir: resolveLabelDir(item.cfg.labelDir, f, unit(sub(on, c))),
                  gap: item.cfg.labelGap ?? 6,
                  active: false,
                  rank: item.cfg.labelRank ?? 40,
                  color: item.cfg.color,
                  font: st.font,
                  subFont: st.subFont,
                  alpha: opacity * ambientAlpha,
                  leader: false,
                });
              }
              break;
            }

            const worldP = item.position(f);
            if (this.checkFinite(item.id, worldP)) break;
            const bodyColor = item.cfg.color ?? theme.body;
            const size = item.cfg.dotSize ?? 4;
            const screenP = toScreen(worldP);
            const hot =
              hover?.mark([screenP], item.name, hoverSub(item.cfg), bodyColor, `${item.id}:body`) ?? false;

            pendingBodies.push(() => {
              const light = lightScreen !== undefined ? unit(sub(lightScreen, screenP)) : undefined;
              const renderer = item.cfg.render ?? defaultBodyRenderer;
              const ctxArg: BodyRenderContext = {
                screen: screenP,
                world: worldP,
                r: size,
                f,
                camera,
                color: bodyColor,
                hot,
                alpha: opacity * ambientAlpha,
                light,
              };
              renderer(ctx, ctxArg);
            });

            if (showLabels && (item.cfg.showLabel ?? true)) {
              const st = labelStyle(item.cfg, theme, hot, f);
              labels.push({
                text: st.text,
                sub: st.sub,
                x: screenP.x,
                y: screenP.y,
                dir: resolveLabelDir(item.cfg.labelDir, f, unit(sub(worldP, c))),
                gap: item.cfg.labelGap ?? size + 6,
                active: hot,
                rank: item.cfg.labelRank ?? 50,
                color: item.cfg.color,
                font: st.font,
                subFont: st.subFont,
                alpha: opacity * ambientAlpha,
                leader: true,
              });
            }
            break;
          }

          case 'anchor': {
            const p = item.position(f);
            if (this.checkFinite(item.id, p)) break;
            const color = item.cfg.color ?? theme.centerMark;
            const marker = item.cfg.marker ?? 'cross';
            const screenP = toScreen(p);

            ctx.globalAlpha = opacity * ambientAlpha;
            if (marker === 'cross' || marker === 'crosshair')
              drawCenterMark(ctx, p, camera.zoom, color, item.cfg.dotSize ?? 5, marker === 'crosshair');
            else if (marker === 'dot') {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(p.x, p.y, (item.cfg.dotSize ?? 3) / camera.zoom, 0, FULL_CIRCLE);
              ctx.fill();
            }
            ctx.globalAlpha = ambientAlpha;

            const hot =
              marker !== 'none'
                ? (hover?.mark([screenP], item.name, hoverSub(item.cfg), color, `${item.id}:anchor`) ?? false)
                : false;
            if (showLabels && marker !== 'none' && (item.cfg.showLabel ?? true)) {
              const st = labelStyle(item.cfg, theme, hot, f);
              labels.push({
                text: st.text,
                sub: st.sub,
                x: screenP.x,
                y: screenP.y,
                dir: resolveLabelDir(item.cfg.labelDir, f, { x: 0.7071, y: -0.7071 }),
                gap: item.cfg.labelGap ?? (item.cfg.dotSize ?? 5) + 6,
                active: hot,
                rank: item.cfg.labelRank ?? 30,
                color: item.cfg.color,
                font: st.font,
                subFont: st.subFont,
                alpha: opacity * ambientAlpha,
                leader: true,
              });
            }
            break;
          }

          case 'angle': {
            if (!showConstruction) break;
            const mid = item.midAt(f);
            if (this.checkFinite(item.id, mid)) break;
            const color = item.cfg.color ?? theme.angle;
            ctx.globalAlpha = opacity * ambientAlpha;
            item.draw(ctx, f, camera.zoom, color);
            ctx.globalAlpha = ambientAlpha;
            const hot =
              hover?.mark(item.hoverPts(f, toScreen), item.name, hoverSub(item.cfg), color, `${item.id}:angle`) ??
              false;
            if (showLabels && (item.cfg.showLabel ?? true)) {
              const midScreen = toScreen(mid);
              const value = item.cfg.showValue ? item.valueTextAt(f) : undefined;
              const st = labelStyle(item.cfg, theme, hot, f);
              // An arc's name belongs outside the arc, away from its vertex -
              // inside it is where the rest of the construction is.
              const outward = unit(sub(mid, item.vertexAt(f)));
              labels.push({
                text: st.text,
                // Under `hebrewFirst` the gloss and the value are one line
                // ("the course · 32.1°"): they are a single statement, and
                // splitting them costs a third line of text on a figure that
                // is already naming a dozen things at once.
                sub: item.cfg.hebrewFirst
                  ? [st.sub, value].filter(Boolean).join(' · ') || undefined
                  : (st.sub ?? value),
                note: !item.cfg.hebrewFirst && st.sub && value ? value : undefined,
                x: midScreen.x,
                y: midScreen.y,
                dir: resolveLabelDir(item.cfg.labelDir, f, outward),
                gap: item.cfg.labelGap ?? 6,
                active: hot,
                rank: item.cfg.labelRank ?? 60,
                color: item.cfg.color,
                font: st.font,
                subFont: st.subFont,
                alpha: opacity * ambientAlpha,
                leader: false,
              });
            }
            break;
          }

          case 'connector': {
            if (!showConstruction) break;
            const a = item.fromAt(f);
            const b = item.toAt(f);
            if (this.checkFinite(item.id, a, b)) break;
            const color = item.cfg.color ?? theme.connector;
            ctx.globalAlpha = opacity * ambientAlpha;
            item.draw(ctx, f, camera.zoom, color);
            ctx.globalAlpha = ambientAlpha;
            const hot =
              hover?.mark(
                [toScreen(a), toScreen(b)],
                item.name,
                hoverSub(item.cfg),
                color,
                `${item.id}:connector`,
              ) ?? false;
            if (showLabels && (item.cfg.showLabel ?? false)) {
              const at = toScreen(item.labelPointAt(f));
              const st = labelStyle(item.cfg, theme, hot, f);
              // Along the line, away from where it started - a sightline's
              // name belongs past the end it is pointing at.
              const along = unit(sub(b, a));
              labels.push({
                text: st.text,
                sub: st.sub,
                x: at.x,
                y: at.y,
                dir: resolveLabelDir(item.cfg.labelDir, f, along),
                gap: item.cfg.labelGap ?? 6,
                active: hot,
                rank: item.cfg.labelRank ?? 45,
                color: item.cfg.color,
                font: st.font,
                subFont: st.subFont,
                alpha: opacity * ambientAlpha,
                leader: false,
              });
            }
            break;
          }

          case 'ringmarker': {
            const p = item.position(f);
            if (this.checkFinite(item.id, p)) break;
            const color = item.cfg.color ?? theme.body;
            const hot =
              hover?.mark(
                item.hoverPts(f, toScreen),
                item.name,
                hoverSub(item.cfg),
                color,
                `${item.id}:marker`,
              ) ?? false;
            ctx.globalAlpha = opacity * ambientAlpha;
            item.draw(ctx, f, camera.zoom, hot ? theme.ink : color);
            ctx.globalAlpha = ambientAlpha;

            if (showLabels && (item.cfg.showLabel ?? true)) {
              const at = item.labelPlacement(f, toScreen, bounds);
              if (at) {
                const st = labelStyle(item.cfg, theme, hot, f);
                const alpha = opacity * ambientAlpha;
                const marker = item;
                if (at.clipped)
                  pendingOverlay.push(() =>
                    marker.drawEdgeArrow(ctx, at, at.dir, hot ? theme.ink : color, alpha),
                  );
                labels.push({
                  text: st.text,
                  sub: st.sub,
                  x: at.x,
                  y: at.y,
                  dir: at.dir,
                  gap: item.cfg.labelGap ?? (at.clipped ? 10 : 12),
                  active: hot,
                  rank: item.cfg.labelRank ?? 35,
                  color: hot ? theme.ink : item.cfg.color,
                  font: st.font,
                  subFont: st.subFont,
                  alpha,
                  leader: false,
                });
              }
            }
            break;
          }

          case 'trail': {
            const color = item.cfg.color ?? theme.trail;
            const anchor = trailAnchor(item, f);
            // Hang the trail's stored shape off its anchor's position now,
            // inside the ambient `-ref` this pass applies to every item —
            // the per-sample subtraction it already carries was done against
            // each sample's own past moment, which is a different thing (see
            // toScreenTrail above and trail.ts's pushSample).
            ctx.save();
            ctx.translate(anchor.x, anchor.y);
            item.draw(ctx, f, camera.zoom, opacity * ambientAlpha, color);
            ctx.restore();
            if (hover) {
              const pts = item.points(f);
              if (pts.length > 1) {
                const toScreenRel = toScreenTrail(anchor);
                // A hover hit-test needs far fewer points than a smooth
                // curve does — every ~1/24th of the trail is plenty to
                // find "the pointer is near this line" within threshold.
                const stride = Math.max(1, Math.floor(pts.length / 24));
                const sampled: Vec[] = [];
                // Both indexes below are in range by construction: the loop
                // bound is pts.length itself, and pts.length > 1 was just
                // checked above — the `!`s only satisfy noUncheckedIndexedAccess.
                for (let i = 0; i < pts.length; i += stride) sampled.push(toScreenRel(pts[i]!));
                sampled.push(toScreenRel(pts[pts.length - 1]!));
                // Full resolution, for drawHighlight() to trace the same
                // smooth curve the trail is actually drawn with — `sampled`
                // above is deliberately coarser, plenty for hit-testing but
                // visibly straight-edged if used for the highlight itself.
                const curvePts = pts.map(toScreenRel);
                hover.mark(sampled, item.name, hoverSub(item.cfg), color, `${item.id}:trail`, curvePts);
              }
            }
            break;
          }

          default:
            assertNever(item);
        }
      }
    } finally {
      // Always undo the camera transform, even if a Scalar or a custom
      // radius/eccentricity function threw mid-frame — otherwise a single
      // bad frame leaves every subsequent one drawn in the wrong space.
      ctx.restore();
    }

    // Isolated in its own save/restore: a body renderer (default or
    // author-supplied) sets ctx.globalAlpha/fillStyle/etc. freely while
    // drawing, and this guarantees none of that leaks past the pass —
    // rather than relying on every renderer to restore what it touched.
    ctx.save();
    try {
      for (const drawBody of pendingBodies) drawBody();
      for (const drawOverlay of pendingOverlay) drawOverlay();
    } finally {
      ctx.restore();
    }

    return labels;
  }
}
