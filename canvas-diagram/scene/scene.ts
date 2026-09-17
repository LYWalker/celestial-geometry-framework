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

import { FULL_CIRCLE, sub, polar, unit, type Vec } from '../geometry.js';
import { applyCamera, worldToScreen, type Camera } from '../camera.js';
import type { Face, Label, LabelTheme } from '../labels.js';
import type { HoverController } from '../hover.js';
import { Sphere } from './sphere.js';
import { Angle } from './angle.js';
import { Connector, drawCenterMark } from './connector.js';
import { Anchor } from './anchor.js';
import { Trail } from './trail.js';
import {
  type BodyRenderContext,
  type BodyRenderer,
  type Frame,
  type PointLike,
  resolveBool,
  resolveDirection,
  resolvePoint,
  resolveScalar,
} from './types.js';

export type SceneItem = Sphere | Angle | Connector | Anchor | Trail;

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
  body: 30,
} as const;

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
    default:
      return assertNever(item);
  }
}

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
    const ref = resolvePoint(opts.ref, f);
    const toScreen = (p: Vec) => worldToScreen(p, ref, camera);
    // A Trail's own points are already relative to *its* `relativeTo` (see
    // trail.ts) — typically the same point as `ref`, just re-resolved at
    // each sample's own past moment. Screen-mapping them through `ref`
    // again, the way every other kind's raw world coordinates need, would
    // subtract that point twice and drag the whole trail off by `ref`'s
    // current value. Zero stands in for "no further recentring."
    const toScreenRel = (p: Vec) => worldToScreen(p, { x: 0, y: 0 }, camera);
    const labels: Label[] = [];
    const pendingBodies: (() => void)[] = [];
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
              ctx.globalAlpha = opacity * ambientAlpha;
              ctx.strokeStyle = color;
              ctx.beginPath();
              ctx.arc(c.x, c.y, r, 0, FULL_CIRCLE);
              ctx.stroke();
              // An exact analytic hover zone (not a 32-gon approximation),
              // and registered unconditionally now — the sun's own eccentric
              // circle is exactly the kind of line a figure most wants
              // hoverable, and its `:ring`/`:body` ids no longer collide.
              hover?.markCircle(toScreen(c), r * camera.zoom, item.name, hoverSub(item.cfg), color, `${item.id}:ring`);
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
                const p = polar(dir, r);
                const at = toScreen({ x: c.x + p.x, y: c.y + p.y });
                labels.push({
                  text: item.name,
                  sub: item.cfg.nameHe,
                  x: at.x,
                  y: at.y,
                  dir: polar(dir, 1),
                  gap: item.cfg.labelGap ?? 6,
                  active: false,
                  rank: item.cfg.labelRank ?? 40,
                  color: item.cfg.color,
                  font: theme.font,
                  subFont: theme.subFont,
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
              labels.push({
                text: item.name,
                sub: item.cfg.nameHe,
                x: screenP.x,
                y: screenP.y,
                dir: unit(sub(worldP, c)),
                gap: item.cfg.labelGap ?? size + 6,
                active: hot,
                rank: item.cfg.labelRank ?? 50,
                color: item.cfg.color,
                font: hot ? theme.activeFont : theme.font,
                subFont: theme.subFont,
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
            if (marker === 'cross') drawCenterMark(ctx, p, camera.zoom, color, item.cfg.dotSize ?? 5);
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
              labels.push({
                text: item.name,
                sub: item.cfg.nameHe,
                x: screenP.x,
                y: screenP.y,
                dir: { x: 1, y: -1 },
                gap: item.cfg.labelGap ?? (item.cfg.dotSize ?? 5) + 6,
                active: hot,
                rank: item.cfg.labelRank ?? 30,
                color: item.cfg.color,
                font: theme.font,
                subFont: theme.subFont,
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
              const value = item.cfg.showValue ? `${item.valueAt(f).toFixed(1)}°` : undefined;
              labels.push({
                text: item.name,
                sub: item.cfg.nameHe ?? value,
                note: item.cfg.nameHe && value ? value : undefined,
                x: midScreen.x,
                y: midScreen.y,
                dir: { x: 0, y: -1 },
                gap: item.cfg.labelGap ?? 6,
                active: hot,
                rank: item.cfg.labelRank ?? 60,
                color: item.cfg.color,
                font: theme.font,
                subFont: theme.subFont,
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
              const mid = toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
              labels.push({
                text: item.name,
                sub: item.cfg.nameHe,
                x: mid.x,
                y: mid.y,
                dir: { x: 0, y: -1 },
                gap: item.cfg.labelGap ?? 6,
                active: hot,
                rank: item.cfg.labelRank ?? 45,
                color: item.cfg.color,
                font: theme.font,
                subFont: theme.subFont,
                alpha: opacity * ambientAlpha,
                leader: false,
              });
            }
            break;
          }

          case 'trail': {
            const color = item.cfg.color ?? theme.trail;
            // Undo the ambient `-ref` this pass otherwise applies to every
            // item — the trail's own points already carry that subtraction,
            // done per-sample against each sample's own past moment (see
            // toScreenRel above and trail.ts's pushSample).
            ctx.save();
            ctx.translate(ref.x, ref.y);
            item.draw(ctx, f, camera.zoom, opacity * ambientAlpha, color);
            ctx.restore();
            if (hover) {
              const pts = item.points(f);
              if (pts.length > 1) {
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
    } finally {
      ctx.restore();
    }

    return labels;
  }
}
