/**
 * The chrome every figure in this style starts from: a starfield behind
 * everything, an optional ring of named segments at the frame's edge (the
 * zodiac, in the Rambam figures — anything divided into even arcs elsewhere),
 * and the pan/zoom pointer wiring, all so a new diagram's job is to declare
 * its Scene and hand this class a canvas, not to re-derive "drag to pan."
 * Domain decisions — what a click does, what a drag clears — stay with the
 * caller, same as camera.ts's own philosophy: this only does the arithmetic
 * and the two decorations almost every figure wants.
 */

import { DEG, FULL_CIRCLE, type Box, type Vec } from '../geometry.js';
import { panBy, pinchAt, worldToScreen, zoomAt, type Camera } from '../camera.js';
import { drawLabels as drawLabelsKit, type Face, type Label, type LabelTheme } from '../labels.js';
import type { HoverController } from '../hover.js';
import type { Scene, SceneTheme } from './scene.js';
import { ORIGIN, resolvePoint, type Frame, type PointLike } from './types.js';

export interface BackgroundTheme {
  /** the gradient behind the whole stage, centre to edge */
  mid: string;
  deep: string;
  star: string;
  /** the vignette's colour at its outer edge — the inner (transparent) stop
   * is derived from this same colour, so there's only one colour to theme */
  vignette: string;
}

export interface ZodiacSegment {
  name: string;
  nameHe?: string;
}

export interface ZodiacConfig {
  /** the ring's inner radius, world px — usually the outermost sphere's */
  radius: number;
  /** how wide the band of names is, world px */
  band?: number;
  segments: ZodiacSegment[];
  font?: Face;
  color?: string;
  /** the world point the ring is centred on. Default the origin — a zodiac
   * is a fixed backdrop, not tied to whatever the camera's `ref` happens to
   * be (which is why this is its own field rather than reusing `ref`). */
  center?: PointLike;
}

export interface StageConfig {
  canvas: HTMLCanvasElement;
  background?: BackgroundTheme | false;
  zodiac?: ZodiacConfig | false;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
  bright: boolean;
  /** index into STAR_DEPTHS — stored rather than re-looked-up so
   * drawBackground can hoist the one Math.pow() per depth per frame,
   * instead of one per star */
  depthIndex: number;
}

const STAR_DEPTHS = [0.12, 0.35, 0.6];
const STAR_COUNTS = [220, 120, 70];

/** Tuned together; named so the next person adjusting the starfield's look
 * has one place to do it rather than six scattered literals. */
const STARFIELD = {
  /** world px the field spans, each axis — should exceed the largest
   * viewport diagonal a figure is likely to render at, so panning never
   * reveals a bare corner */
  extent: 2600,
  radiusBase: 0.8,
  radiusMin: 0.3,
  radiusPerLayer: 0.3,
  alphaBase: 0.4,
  alphaMin: 0.15,
  alphaPerLayer: 0.08,
  /** how many of the nearest layer's stars get a halo */
  brightCount: 12,
  twinkleRate: 0.0009,
  twinkleDepth: 0.28,
  twinkleBase: 0.72,
  /** the halo sprite's radius, world-independent screen px */
  glowRadius: 6,
} as const;

/** A cached, off-DOM 2D context used only to ask the browser to parse an
 * arbitrary CSS colour string and hand back its RGB channels — the only
 * reliable way to derive "this same colour, but transparent" (for a
 * gradient's inner stop) without a CSS colour-parsing dependency. */
let colorParseCtx: CanvasRenderingContext2D | null = null;
/** Module-global and shared across every Stage/figure on the page, same as
 * labels.ts's own measureCache and for the same reason (parsing is the
 * only real cost here, and the same theme colour is asked for repeatedly).
 * Left without a size cap or a clear function, unlike measureCache: it's
 * keyed on *distinct CSS colour strings*, which for any realistic theme
 * palette — even several figures' worth, each with their own — is a
 * handful of entries, not a user-influenced, effectively-unbounded set the
 * way measureCache's label text is. See Stage.destroy()'s own comment. */
const rgbCache = new Map<string, [number, number, number]>();
function cssColorRgb(css: string): [number, number, number] {
  const cached = rgbCache.get(css);
  if (cached) return cached;
  if (!colorParseCtx) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    colorParseCtx = c.getContext('2d', { willReadFrequently: true });
  }
  let rgb: [number, number, number] = [255, 255, 255];
  if (colorParseCtx) {
    colorParseCtx.clearRect(0, 0, 1, 1);
    colorParseCtx.fillStyle = css;
    colorParseCtx.fillRect(0, 0, 1, 1);
    const d = colorParseCtx.getImageData(0, 0, 1, 1).data;
    // A 1x1 getImageData() always yields exactly 4 bytes (RGBA) — the `!`s
    // just satisfy noUncheckedIndexedAccess.
    rgb = [d[0]!, d[1]!, d[2]!];
  }
  rgbCache.set(css, rgb);
  return rgb;
}

/**
 * Canvas backing-store sizing, the star field, the background wash, and (if
 * configured) the segmented ring at the diagram's edge. Owns nothing about
 * what the diagram *is* — that's the Scene — only how the stage under it looks.
 */
export class Stage {
  readonly ctx: CanvasRenderingContext2D;
  camera: Camera = { zoom: 1, pan: { x: 0, y: 0 }, cx: 0, cy: 0 };
  w = 0;
  h = 0;
  /** the zoom at which `fitRadius` (passed to resize()) just fits the frame */
  fit = 1;
  /** the lowest a label may sit, in canvas-local px — set by resize()'s `bottom` */
  safeBottom = 0;
  /** DOM chrome floating over the canvas that labels should keep clear of —
   * set by resize()'s `obstacles` */
  obstacles: Box[] = [];

  private stars: Star[] = [];
  private zodiacBoxes: Box[] = [];
  /** rebuilt only in resize() — cx/cy/w/h (what these depend on) never
   * change outside it; pan/zoom, which do change every frame, don't affect
   * either gradient's own stops, only where drawBackground paints them */
  private washGradient: CanvasGradient | null = null;
  private vignetteGradient: CanvasGradient | null = null;
  /** a bright star's halo, baked once at full-ish alpha and redrawn with
   * globalAlpha doing the per-frame twinkle, instead of building a fresh
   * radial gradient for all 12 bright stars every single frame */
  private starGlowSprite: HTMLCanvasElement | null = null;

  constructor(private cfg: StageConfig) {
    this.ctx = cfg.canvas.getContext('2d')!;
  }

  /**
   * Recompute the canvas's backing size for its current CSS size, and the
   * point the camera holds still. `top`/`bottom` are room to leave clear (in
   * CSS px) for chrome stacked above or below the canvas; `fitRadius`, if
   * given, is the world radius that should just fit the frame at zoom 1 —
   * `this.fit` comes out as the zoom that achieves that, so a caller seeds
   * `camera.zoom = stage.fit` on first load and re-derives it on resize
   * without the diagram itself doing any of that arithmetic. `obstacles`,
   * if given, are DOM elements floating over the canvas (button clusters,
   * a legend) that drawLabels()/render() will keep label text clear of —
   * pass the same elements each resize, since their rects are re-measured here.
   *
   * Returns whether it actually resized: a canvas under 2px in either
   * dimension (typically because it's inside a `display: none` tab, an
   * unopened `<details>`, or hasn't been laid out yet) can't be measured
   * usefully, so this is a no-op that leaves every field — including
   * `stars`, still empty on a first call — exactly as it was, and returns
   * `false` so a caller can tell the difference from a real resize and
   * retry later (a ResizeObserver firing again once the element actually
   * gets a size, a tab-shown handler, and so on) rather than silently
   * rendering a blank figure with no signal anything went wrong.
   */
  resize(opts: { top?: number; bottom?: number; fitRadius?: number; obstacles?: HTMLElement[] } = {}): boolean {
    const canvas = this.cfg.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const top = opts.top ?? 0;
    const bottom = opts.bottom ?? 0;
    const safeH = Math.max(80, this.h - top - bottom);
    this.camera.cx = this.w / 2;
    this.camera.cy = top + safeH / 2;
    this.safeBottom = this.h - bottom;

    if (opts.fitRadius) {
      const was = this.camera.zoom / this.fit;
      this.fit = Math.min(this.w / 2 - 14, safeH / 2) / opts.fitRadius;
      this.camera.zoom = this.fit * (Number.isFinite(was) && was > 0 ? was : 1);
    }

    this.obstacles = (opts.obstacles ?? [])
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height };
      })
      .filter((b) => b.w > 0 && b.h > 0);

    if (this.stars.length === 0) this.seedStars();
    this.rebuildBackgroundGradients();
    return true;
  }

  seedStars(): void {
    this.stars = [];
    // STAR_DEPTHS and STAR_COUNTS are parallel, same-length arrays by
    // construction (see their declarations above) — `layer`, an index into
    // STAR_DEPTHS, is always a valid index into STAR_COUNTS too.
    STAR_DEPTHS.forEach((_depth, layer) => {
      const n = STAR_COUNTS[layer]!;
      for (let i = 0; i < n; i++)
        this.stars.push({
          x: (Math.random() - 0.5) * STARFIELD.extent,
          y: (Math.random() - 0.5) * STARFIELD.extent,
          r: Math.random() * STARFIELD.radiusBase + STARFIELD.radiusMin + layer * STARFIELD.radiusPerLayer,
          a: Math.random() * STARFIELD.alphaBase + STARFIELD.alphaMin + layer * STARFIELD.alphaPerLayer,
          tw: Math.random() * Math.PI * 2,
          bright: layer === STAR_DEPTHS.length - 1 && i < STARFIELD.brightCount,
          depthIndex: layer,
        });
    });
  }

  /** Change the background theme at runtime — a light/dark toggle, say —
   * without rebuilding the Stage and losing camera state (`cfg` is
   * otherwise private, and was set once in the constructor with no way to
   * change it afterward). Pass `false` to turn the background off entirely.
   * Rebuilds the dependent gradients (and, lazily, the star-glow sprite) so
   * the very next drawBackground()/render() call already reflects it. */
  setBackground(bg: BackgroundTheme | false): void {
    this.cfg.background = bg;
    this.rebuildBackgroundGradients();
  }

  /** Change the zodiac ring at runtime, same idea as setBackground() — pass
   * `false` to turn it off. There's no cached geometry to rebuild here:
   * drawZodiac() derives its ring and label boxes fresh from `cfg.zodiac`
   * every call, so this is just the assignment, exposed alongside
   * setBackground() for a symmetrical retheming API. */
  setZodiac(z: ZodiacConfig | false): void {
    this.cfg.zodiac = z;
  }

  /** Release this Stage's own resources — the star-glow sprite canvas, the
   * cached background/vignette gradients, and the star array — for a
   * caller that creates and tears down many Stages (route changes, several
   * instances of a figure mounted and unmounted) and doesn't want them to
   * accumulate. Does not touch the canvas element itself (the caller owns
   * that) or `cfg`. Does not touch the module-global `rgbCache` (below) or
   * labels.ts's `measureCache` either — both are deliberately shared across
   * every Stage/figure on the page, not per-instance state: `rgbCache` is
   * bounded by the number of *distinct* CSS colour strings any figure ever
   * asks it to parse, which for a fixed theme palette is a handful, not an
   * unbounded set, so there's nothing here worth a destroy()-triggered
   * clear; `measureCache` already caps and clears itself (see its own
   * comment). A Stage instance that's been destroy()ed is simply done —
   * build a fresh one (`new Stage(...)`) rather than trying to resurrect it. */
  destroy(): void {
    this.starGlowSprite = null;
    this.washGradient = null;
    this.vignetteGradient = null;
    this.stars = [];
  }

  private rebuildBackgroundGradients(): void {
    const bg = this.cfg.background;
    if (!bg) {
      this.washGradient = this.vignetteGradient = null;
      return;
    }
    const ctx = this.ctx;
    const { cx, cy } = this.camera;
    const { w, h } = this;

    const g = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy * 0.9, Math.max(w, h) * 0.78);
    g.addColorStop(0, bg.mid);
    g.addColorStop(1, bg.deep);
    this.washGradient = g;

    const [vr, vg, vb] = cssColorRgb(bg.vignette);
    const v = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.35, cx, cy, Math.hypot(w, h) * 0.62);
    v.addColorStop(0, `rgba(${vr},${vg},${vb},0)`);
    v.addColorStop(1, bg.vignette);
    this.vignetteGradient = v;

    this.starGlowSprite = null; // rebuilt lazily from the (possibly new) bg.star
  }

  private buildStarGlowSprite(starColor: string): HTMLCanvasElement {
    const [r, g, b] = cssColorRgb(starColor);
    const size = STARFIELD.glowRadius * 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const sctx = c.getContext('2d')!;
    const grad = sctx.createRadialGradient(
      STARFIELD.glowRadius,
      STARFIELD.glowRadius,
      0,
      STARFIELD.glowRadius,
      STARFIELD.glowRadius,
      STARFIELD.glowRadius,
    );
    grad.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    sctx.fillStyle = grad;
    sctx.beginPath();
    sctx.arc(STARFIELD.glowRadius, STARFIELD.glowRadius, STARFIELD.glowRadius, 0, FULL_CIRCLE);
    sctx.fill();
    return c;
  }

  /** The gradient wash, the star field (each depth following the camera by
   * its own fraction, so zooming spreads the near ones and barely moves the
   * far ones), and a vignette. A no-op if `background` was set to `false`. */
  drawBackground(t: number): void {
    const bg = this.cfg.background;
    if (!bg || !this.washGradient || !this.vignetteGradient) return;
    const ctx = this.ctx;
    const { camera: cam, w, h } = this;

    ctx.fillStyle = this.washGradient;
    ctx.fillRect(0, 0, w, h);

    const zr = this.fit > 0 ? cam.zoom / this.fit : cam.zoom;
    const kByDepth = STAR_DEPTHS.map((d) => 0.5 * Math.pow(zr, d));

    for (const s of this.stars) {
      // s.depthIndex is always a valid STAR_DEPTHS/kByDepth index — it's set
      // from seedStars()'s own STAR_DEPTHS.forEach index above and never
      // touched anywhere else.
      const depth = STAR_DEPTHS[s.depthIndex]!;
      const k = kByDepth[s.depthIndex]!;
      const p = { x: cam.cx + cam.pan.x * depth + s.x * k, y: cam.cy + cam.pan.y * depth + s.y * k };
      if (p.x < -4 || p.x > w + 4 || p.y < -4 || p.y > h + 4) continue;
      const a = s.a * (STARFIELD.twinkleBase + STARFIELD.twinkleDepth * Math.sin(t * STARFIELD.twinkleRate + s.tw));
      if (s.bright) {
        this.starGlowSprite ??= this.buildStarGlowSprite(bg.star);
        ctx.globalAlpha = a;
        ctx.drawImage(
          this.starGlowSprite,
          p.x - STARFIELD.glowRadius,
          p.y - STARFIELD.glowRadius,
          STARFIELD.glowRadius * 2,
          STARFIELD.glowRadius * 2,
        );
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = bg.star;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.bright ? s.r + 0.5 : s.r, 0, FULL_CIRCLE);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = this.vignetteGradient;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * The optional ring of named segments at the diagram's edge, centred on
   * `zodiac.center` (world space, default the origin) — resolved against
   * `ref` the same way anything else in the scene is, via `f`/`ref`. Returns
   * the screen boxes its labels occupy, for a Scene's own labels to avoid;
   * you don't need to collect this yourself if you use `drawLabels()`/`render()`.
   */
  drawZodiac(f: Frame, ref: Vec, opts: { alpha?: number | undefined; labels?: boolean | undefined } = {}): Box[] {
    this.zodiacBoxes = [];
    const z = this.cfg.zodiac;
    if (!z) return [];
    const ctx = this.ctx;
    const cam = this.camera;
    const alpha = opts.alpha ?? 1;
    const centerWorld = resolvePoint(z.center ?? ORIGIN, f);
    const centerScreen = worldToScreen(centerWorld, ref, cam);
    const cx = centerScreen.x;
    const cy = centerScreen.y;
    const R = z.radius * cam.zoom;
    const band = (z.band ?? z.radius * 0.18) * cam.zoom;
    const R2 = R + band;
    if (R2 > Math.hypot(this.w, this.h) * 3) return [];

    const n = z.segments.length;
    const color = z.color ?? 'rgba(150,168,214,0.2)';
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, FULL_CIRCLE);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R2, 0, FULL_CIRCLE);
    ctx.stroke();
    for (let i = 0; i < n * 3; i++) {
      const a = ((i * 360) / (n * 3)) * DEG;
      const len = i % 3 === 0 ? R2 : R + 4 * cam.zoom;
      ctx.beginPath();
      ctx.moveTo(cx + R * Math.cos(a), cy - R * Math.sin(a));
      ctx.lineTo(cx + len * Math.cos(a), cy - len * Math.sin(a));
      ctx.stroke();
    }

    if (opts.labels ?? true) {
      const Rl = (R + R2) / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.font = (z.font ?? { css: '600 9.5px system-ui, sans-serif', px: 9.5 }).css;
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) * 360) / n;
        const p = { x: cx + Rl * Math.cos(a * DEG), y: cy - Rl * Math.sin(a * DEG) };
        if (p.x < -50 || p.x > this.w + 50 || p.y < -20 || p.y > this.h + 20) continue;
        // i < n === z.segments.length, so this index is always in range.
        const name = z.segments[i]!.name.toUpperCase();
        ctx.fillText(name, p.x, p.y);
        const w = ctx.measureText(name).width;
        this.zodiacBoxes.push({ x: p.x - w / 2, y: p.y - 6, w, h: 12 });
      }
    }
    ctx.restore();
    return this.zodiacBoxes;
  }

  /** drawLabels(), pre-loaded with this stage's own obstacles (DOM chrome
   * from resize()'s `obstacles`, plus the zodiac ring's own names from the
   * most recent drawZodiac() call) so a caller doesn't have to remember to
   * merge them in — the exact collision drawLabels()'s own docs warn about. */
  drawLabels(labels: Label[], theme: LabelTheme, extraObstacles: Box[] = []): void {
    drawLabelsKit(
      this.ctx,
      labels,
      {
        obstacles: [...this.obstacles, ...this.zodiacBoxes, ...extraObstacles],
        width: this.w,
        safeBottom: this.safeBottom || this.h,
      },
      theme,
    );
  }

  /**
   * The one call a straightforward figure needs per frame: background,
   * zodiac, the Scene, the hover tooltip, labels, the hover highlight — in
   * the order they have to happen in (labels after the hover state they
   * read is current; the highlight glow after labels, in screen space, once
   * the camera transform is long since undone). `beforeScene`/`afterScene`
   * are the insertion points for a figure that needs a layer between
   * background and Scene (Orrery's shell fade and orbit trails sit there)
   * or that wants to add its own Label entries to the ones Scene produced
   * before they're laid out — not just an escape hatch to the piecewise
   * methods below, which remain available for a figure that wants a
   * different order entirely.
   *
   * `backgroundTime`, if omitted, defaults to `performance.now()` — meaning
   * render() is *not* a pure function of `f` by default, so the starfield's
   * twinkle keeps moving even across redraws that only happen on pointer
   * events rather than every animation frame. Pass an explicit
   * `backgroundTime` (e.g. tied to `f.t`) for a figure that redraws only on
   * demand and wants the sky to stay still between those redraws too.
   */
  render(opts: {
    scene: Scene;
    f: Frame;
    ref: PointLike;
    theme: SceneTheme;
    hover?: HoverController;
    pointer: Vec | null;
    lightSource?: PointLike;
    showLabels?: boolean;
    showConstruction?: boolean;
    showRings?: boolean;
    zodiacAlpha?: number;
    zodiacLabels?: boolean;
    extraObstacles?: Box[];
    backgroundTime?: number;
    beforeScene?: () => void;
    afterScene?: (labels: Label[]) => void;
  }): void {
    const ref = resolvePoint(opts.ref, opts.f);
    this.drawBackground(opts.backgroundTime ?? performance.now());
    this.drawZodiac(opts.f, ref, { alpha: opts.zodiacAlpha, labels: opts.zodiacLabels });
    opts.beforeScene?.();
    const labels = opts.scene.draw({
      ctx: this.ctx,
      f: opts.f,
      ref,
      camera: this.camera,
      theme: opts.theme,
      hover: opts.hover,
      lightSource: opts.lightSource,
      showLabels: opts.showLabels,
      showConstruction: opts.showConstruction,
      showRings: opts.showRings,
    });
    opts.hover?.update(opts.pointer);
    opts.afterScene?.(labels);
    this.drawLabels(labels, opts.theme, opts.extraObstacles);
    if (opts.hover) opts.hover.drawHighlight(this.ctx, opts.theme.ink);
  }
}

/** update()'s default wheel-zoom feel — how many "zoom factor e-foldings"
 * per pixel of (normalised) wheel delta. */
export const WHEEL_ZOOM_SENSITIVITY = 0.0014;
/** a pointer must move this many px before a press becomes a drag rather
 * than resolving as a click on release */
const DRAG_SLOP_PX = 2;
/** touch needs more slack — a fingertip rolls more than a mouse click does */
const TOUCH_DRAG_SLOP_PX = 6;

export interface CameraWireOptions {
  canvas: HTMLCanvasElement;
  camera: Camera;
  minZoom: number | (() => number);
  maxZoom: number | (() => number);
  /** how strongly the wheel zooms; default WHEEL_ZOOM_SENSITIVITY */
  zoomSensitivity?: number;
  /** the pointer's canvas-local position while it's hovering and not
   * dragging/pinching; null while it's off the canvas or mid-gesture */
  onHover?: (p: Vec | null) => void;
  /** a pointerup that wasn't a drag — a plain click/tap, at this canvas-local point */
  onClick?: (p: Vec) => void;
  /** the camera's pan or zoom changed — request a redraw */
  onChange?: () => void;
  /** a drag or pinch just started — fires once per gesture, not per move.
   * A caller doing anything non-idempotent (push undo state, drop a
   * selection) wants this rather than onHover(null), which also fires on
   * every move of an already-started drag. */
  onDragStart?: () => void;
  /** the pointer just went down — before it's known whether this becomes a
   * drag, a pinch, or a click. Orrery uses this to move keyboard focus onto
   * the canvas on click; nothing else in this wiring happens early enough
   * for that. */
  onPointerDown?: (e: PointerEvent) => void;
}

/**
 * Wires a canvas's wheel/pointer events to camera.ts's anchor-point algebra:
 * wheel and pinch zoom on the point under the cursor/fingers, one-finger drag
 * pans, and a drag that never really moved resolves as a click. This is
 * exactly Orrery.astro's own pointer handling, lifted out so a new figure
 * gets "drag to pan, scroll to zoom, pinch on touch" without writing it
 * again — what a click *does* is still the caller's, via onClick.
 */
export function wireCamera(opts: CameraWireOptions): () => void {
  const { canvas, camera } = opts;
  const minZoom = () => (typeof opts.minZoom === 'function' ? opts.minZoom() : opts.minZoom);
  const maxZoom = () => (typeof opts.maxZoom === 'function' ? opts.maxZoom() : opts.maxZoom);
  const sensitivity = opts.zoomSensitivity ?? WHEEL_ZOOM_SENSITIVITY;

  // getBoundingClientRect() forces layout; a canvas's CSS rect only changes
  // on resize/scroll (never merely from panning/zooming its own contents),
  // so it's cached rather than re-measured on every wheel tick and every
  // pointermove — which, at 120Hz mouse polling while dragging, is the
  // difference between one reflow and well over a hundred per second.
  let cachedRect: DOMRect | null = null;
  const rectOf = () => (cachedRect ??= canvas.getBoundingClientRect());
  const invalidateRect = () => {
    cachedRect = null;
  };
  window.addEventListener('resize', invalidateRect);
  window.addEventListener('scroll', invalidateRect, true);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = rectOf();
    const mx = e.clientX - rect.left - camera.cx;
    const my = e.clientY - rect.top - camera.cy;
    // e.deltaY's unit depends on deltaMode: pixels (0, the common case),
    // lines (1, some Firefox configurations — ~16px each), or pages (2,
    // rare). Treated as pixels regardless, the last two zoom 16x-500x too
    // slowly for the gesture to feel like it did anything.
    const pxDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * canvas.clientHeight : e.deltaY;
    zoomAt(camera, mx, my, Math.exp(-pxDelta * sensitivity), minZoom(), maxZoom());
    opts.onChange?.();
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });

  let dragging = false;
  let dragMoved = false;
  let last = { x: 0, y: 0 };
  const pointers = new Map<number, Vec>();
  let pinchDist = 0;
  let pinchMid = { x: 0, y: 0 };
  const pinchOf = () => {
    const [a, b] = [...pointers.values()];
    // Only ever called from onDown/onMove after checking pointers.size === 2
    // — an internal invariant, not something a caller outside this closure
    // can violate, so a thrown assertion (rather than a silent fallback)
    // is the right way to catch a regression in that invariant early.
    if (!a || !b) throw new Error(`canvas-diagram wireCamera: pinchOf() needs 2 active pointers, had ${pointers.size}`);
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onDown = (e: PointerEvent) => {
    invalidateRect();
    // Can throw (NotFoundError) if the browser doesn't consider this
    // pointer "active" — observed from a synthetically dispatched
    // PointerEvent, but nothing rules out a real one hitting the same edge
    // case. Uncaught, it would abort the rest of this handler — dropping
    // the pointer from `pointers`, skipping onPointerDown, and never
    // starting a drag — over a capture that's an optimisation (keeps a
    // drag tracking outside the canvas bounds), not a requirement.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    opts.onPointerDown?.(e);
    if (pointers.size === 2) {
      dragMoved = true;
      ({ dist: pinchDist, mid: pinchMid } = pinchOf());
      opts.onDragStart?.();
    } else if (pointers.size === 1) {
      dragging = true;
      dragMoved = false;
      last = { x: e.clientX, y: e.clientY };
    }
  };

  const onMove = (e: PointerEvent) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      if (!dragMoved) opts.onDragStart?.();
      dragMoved = true;
      const rect = rectOf();
      const { dist, mid } = pinchOf();
      const mx = mid.x - rect.left - camera.cx;
      const my = mid.y - rect.top - camera.cy;
      const mx0 = pinchMid.x - rect.left - camera.cx;
      const my0 = pinchMid.y - rect.top - camera.cy;
      pinchAt(camera, { x: mx, y: my }, { x: mx0, y: my0 }, dist, pinchDist, minZoom(), maxZoom());
      pinchDist = dist;
      pinchMid = mid;
      opts.onHover?.(null);
      opts.onChange?.();
      return;
    }

    const rect = rectOf();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (dragging) {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      const slop = e.pointerType === 'touch' ? TOUCH_DRAG_SLOP_PX : DRAG_SLOP_PX;
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) > slop) {
        dragMoved = true;
        opts.onDragStart?.();
      }
      panBy(camera, dx, dy);
      last = { x: e.clientX, y: e.clientY };
      opts.onHover?.(null);
      opts.onChange?.();
      return;
    }

    opts.onHover?.({ x: px, y: py });
  };

  const endDrag = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      // pointers.size === 1 just above guarantees this destructure succeeds.
      const [p] = [...pointers.values()];
      last = p!;
      dragging = true;
      dragMoved = true;
      return;
    }
    if (dragging && !dragMoved) {
      const rect = rectOf();
      opts.onClick?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (pointers.size === 0) dragging = false;
  };
  const onCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragging = false;
    opts.onHover?.(null);
  };
  const onLeave = () => {
    // Cleared unconditionally, mid-drag included — Orrery does the same:
    // a stale hover point left over from before the pointer left the canvas
    // would otherwise pin the DOM tooltip at its last position forever.
    opts.onHover?.(null);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);

  // Keyboard camera control — arrow keys pan, +/- zoom, 0 resets. This
  // kit's own convention (see CanvasDiagramDemo.astro's `.stage`) is that
  // the *canvas's wrapper*, not the canvas itself, carries `tabindex="0"`
  // and the aria-label, so the listener lives on `window` (keydown doesn't
  // bubble down from an ancestor into the canvas the way it would bubble
  // up) and is gated on focus itself: `isCanvasFocused()` is true whenever
  // the focused element either *is* the canvas or has the canvas somewhere
  // inside it (`Node.contains()` includes the node itself), covering both
  // "the canvas is directly focusable" and "a wrapper around it is."
  // `preventDefault()` — and `onChange()` — fire only for a key this
  // handler actually understands, so every other key (Tab, a modifier
  // combo, a browser shortcut, or an arrow key while focus is genuinely
  // elsewhere on the page) passes through untouched.
  const KEY_PAN_PX = 40;
  const KEY_ZOOM_FACTOR = 1.2;
  const isCanvasFocused = () => document.activeElement !== null && document.activeElement.contains(canvas);
  // Captured once, at wire-up time — by convention a caller resizes/fits
  // the Stage (which seeds camera.zoom/pan) *before* calling wireCamera(),
  // so this is "the view this figure opened with." A resize after this
  // point (a window resize re-fitting the Stage, say) isn't reflected in
  // what '0' resets to; that's an acceptable gap for a keyboard nicety, not
  // a promise this function makes about tracking a moving target.
  const resetTo = { zoom: camera.zoom, pan: { x: camera.pan.x, y: camera.pan.y } };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isCanvasFocused()) return;
    switch (e.key) {
      case 'ArrowLeft':
        panBy(camera, -KEY_PAN_PX, 0);
        break;
      case 'ArrowRight':
        panBy(camera, KEY_PAN_PX, 0);
        break;
      case 'ArrowUp':
        panBy(camera, 0, -KEY_PAN_PX);
        break;
      case 'ArrowDown':
        panBy(camera, 0, KEY_PAN_PX);
        break;
      case '+':
      case '=': // the unshifted key '+' shares a key with, on most layouts
        zoomAt(camera, 0, 0, KEY_ZOOM_FACTOR, minZoom(), maxZoom());
        break;
      case '-':
      case '_':
        zoomAt(camera, 0, 0, 1 / KEY_ZOOM_FACTOR, minZoom(), maxZoom());
        break;
      case '0':
        camera.zoom = resetTo.zoom;
        camera.pan.x = resetTo.pan.x;
        camera.pan.y = resetTo.pan.y;
        break;
      default:
        return; // not a key this handler understands — leave it alone
    }
    e.preventDefault();
    opts.onChange?.();
  };
  window.addEventListener('keydown', onKeyDown);

  return () => {
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('resize', invalidateRect);
    window.removeEventListener('scroll', invalidateRect, true);
    window.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * The forever-`requestAnimationFrame` loop every figure in this style
 * otherwise hand-rolls, replaced with one that pauses itself rather than
 * burning a frame budget the user can't see or doesn't want: an
 * `IntersectionObserver` stops it while `target` is scrolled out of view,
 * and `matchMedia('(prefers-reduced-motion: reduce)')` — tracked live, not
 * just read once at start — stops it entirely in favour of a single static
 * frame when the user's OS-level setting asks for that. Neither of those
 * has anything to do with *interaction*-driven redraws — a hover, a drag,
 * a click still calls `onFrame` straight from wireCamera's own
 * `onChange`/`onHover` handlers, same as always, whether or not this loop
 * is currently running — so reduced motion means "the scene stops
 * animating on its own clock," not "the figure stops responding."
 *
 * `onFrame` receives the `requestAnimationFrame` timestamp (ms since page
 * load, same as `performance.now()`) so a diagram driven by wall-clock time
 * doesn't need its own `performance.now()` bookkeeping; a diagram driven by
 * something else (a simulated clock, a scrubber) can simply ignore it.
 */
export function wireAnimationLoop(target: Element, onFrame: (t: number) => void): () => void {
  const reduceMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = reduceMotionQuery.matches;
  let visible = true;
  let raf = 0;

  const tick = (t: number) => {
    onFrame(t);
    raf = visible && !reduceMotion ? requestAnimationFrame(tick) : 0;
  };
  const start = () => {
    if (raf === 0 && visible && !reduceMotion) raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const io = new IntersectionObserver((entries) => {
    // Only one entry: `target` is the only element passed to observe().
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
    else stop();
  });
  io.observe(target);

  const onMotionChange = () => {
    reduceMotion = reduceMotionQuery.matches;
    if (reduceMotion) {
      stop();
      onFrame(performance.now()); // one last static frame, not a blank one
    } else start();
  };
  reduceMotionQuery.addEventListener('change', onMotionChange);

  if (reduceMotion) onFrame(performance.now());
  else start();

  return () => {
    stop();
    io.disconnect();
    reduceMotionQuery.removeEventListener('change', onMotionChange);
  };
}
