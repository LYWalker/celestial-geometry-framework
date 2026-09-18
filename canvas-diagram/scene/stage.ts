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
import { drawLabels as drawLabelsKit, type Label, type LabelTheme } from '../labels.js';
import type { HoverController } from '../hover.js';
import type { Scene, SceneTheme } from './scene.js';
import {
  type ZodiacSegment,
  CONSTELLATION_LINE_COLOR,
  CONSTELLATION_NOTE,
  CONSTELLATION_STAR_COLOR,
  DEFAULT_LATITUDE_SPAN,
  ZODIAC_COLOR,
  ZODIAC_LABEL_COLOR,
  ZODIAC_NOTE,
  ZodiacRing,
  type ZodiacConfig,
  type ZodiacGeometry,
} from './zodiac.js';
import { resolvePoint, type Frame, type PointLike } from './types.js';

export interface BackgroundTheme {
  /** the gradient behind the whole stage, centre to edge */
  mid: string;
  deep: string;
  star: string;
  /** the vignette's colour at its outer edge — the inner (transparent) stop
   * is derived from this same colour, so there's only one colour to theme */
  vignette: string;
}

export interface StageConfig {
  canvas: HTMLCanvasElement;
  background?: BackgroundTheme | false;
  /** the ring of named segments at the figure's edge. Pass a plain config
   * for a ring nothing else needs to know about, or a ZodiacRing the figure
   * built itself — which is what lets its own dial lines reach exactly to
   * the ring (`length: ring.outer`) without restating where that is. */
  zodiac?: ZodiacConfig | ZodiacRing | false;
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
  /** what the most recent drawZodiac() found to be hoverable, in screen
   * space - handed to the HoverController by markZodiacHover() rather than
   * marked as they are drawn, because Scene.draw() calls hover.begin() and
   * would throw away anything registered before it */
  private zodiacZones: ZodiacZone[] = [];
  /** the ring itself — the figure's own ZodiacRing when it built one (so
   * `ring.outer` and what's drawn are the same object), otherwise one
   * wrapped around the plain config it was given */
  private ring: ZodiacRing | null = null;
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
    this.ring = toRing(cfg.zodiac);
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
  resize(
    opts: {
      top?: number;
      bottom?: number;
      fitRadius?: number;
      obstacles?: HTMLElement[];
    } = {},
  ): boolean {
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
        return {
          x: r.left - rect.left,
          y: r.top - rect.top,
          w: r.width,
          h: r.height,
        };
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
  setZodiac(z: ZodiacConfig | ZodiacRing | false): void {
    this.cfg.zodiac = z;
    // A ZodiacRing the caller already holds keeps its own identity (its
    // `inner`/`outer` Scalars are wired into the scene); a plain config
    // re-themes the ring in place, which discards its measurement — see
    // ZodiacRing.set(). Either way nothing else in the figure has to be
    // rebuilt to follow.
    if (z instanceof ZodiacRing || !z || !this.ring) this.ring = toRing(z);
    else this.ring.set(z);
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
      const p = {
        x: cam.cx + cam.pan.x * depth + s.x * k,
        y: cam.cy + cam.pan.y * depth + s.y * k,
      };
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
   * Where the zodiac ring sits this frame, in world px — `null` when there
   * is no ring, or when an auto-sized one hasn't been given a Scene to
   * measure yet. A figure that holds its own ZodiacRing can ask it directly
   * (`ring.outer(f)`); this is the same answer, for one built from a plain
   * config, and is what a resize handler wants for `fitRadius`.
   *
   * `scene` is what an auto radius measures; render() passes the Scene it
   * draws, and the ring remembers it, so a later call needn't repeat it.
   */
  zodiacGeometry(f: Frame, scene?: Scene): ZodiacGeometry | null {
    if (!this.ring) return null;
    if (scene) this.ring.fitTo(scene);
    return this.ring.geometry(f);
  }

  /**
   * The optional ring of named segments at the diagram's edge, centred on
   * `zodiac.center` (world space, default the origin) — resolved against
   * `ref` the same way anything else in the scene is, via `f`/`ref`. Returns
   * the screen boxes its labels occupy, for a Scene's own labels to avoid;
   * you don't need to collect this yourself if you use `drawLabels()`/`render()`.
   */
  drawZodiac(
    f: Frame,
    ref: Vec,
    opts: {
      alpha?: number | undefined;
      labels?: boolean | undefined;
      /** the names' own alpha, when they shouldn't fade with the ring's
       * lines. A ring dimmed to a quarter still reads as a ring; its names,
       * dimmed to a quarter, are gone. Defaults to `alpha`. */
      labelAlpha?: number | undefined;
      scene?: Scene | undefined;
    } = {},
  ): Box[] {
    this.zodiacBoxes = [];
    this.zodiacZones = [];
    const ring = this.ring;
    if (!ring) return [];
    const z = ring.cfg;
    const geom = this.zodiacGeometry(f, opts.scene);
    if (!geom || geom.radius <= 0) return [];
    const ctx = this.ctx;
    const cam = this.camera;
    const alpha = opts.alpha ?? 1;
    const labelAlpha = opts.labelAlpha ?? alpha;
    const centerScreen = worldToScreen(geom.center, ref, cam);
    const cx = centerScreen.x;
    const cy = centerScreen.y;
    const R = geom.radius * cam.zoom;
    const band = geom.band * cam.zoom;
    const R2 = R + band;
    if (R2 > Math.hypot(this.w, this.h) * 3) return [];

    const n = z.segments.length;
    const color = z.color ?? ZODIAC_COLOR;
    const note = z.note ?? ZODIAC_NOTE;
    const he = z.language === 'he';
    /** a point at this longitude and screen radius */
    const at = (lon: number, r: number): Vec => ({
      x: cx + r * Math.cos(lon * DEG),
      y: cy - r * Math.sin(lon * DEG),
    });
    const onScreen = (p: Vec, pad = 40) => p.x > -pad && p.x < this.w + pad && p.y > -pad && p.y < this.h + pad;

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

    if (z.constellations && geom.artBand > 0)
      this.drawConstellations(f, geom, {
        cx,
        cy,
        R2,
        alpha,
        labelAlpha,
        at,
        onScreen,
      });

    const Rl = (R + R2) / 2;
    if (opts.labels ?? true) {
      ctx.globalAlpha = labelAlpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = z.labelColor ?? ZODIAC_LABEL_COLOR;
      const face = (he ? (z.fontHe ?? z.font) : z.font) ?? {
        css: '600 9.5px system-ui, sans-serif',
        px: 9.5,
      };
      ctx.font = face.css;
      // A name wider than its own segment runs into its neighbour's — at a
      // small size SAGITTARIUS and CAPRICORN meet and read as one word. The
      // first three letters are what an astronomer would have written
      // anyway; the test is over all twelve rather than each in turn, so
      // the ring never mixes the two forms and reads as an accident.
      const nameOf = (seg: ZodiacSegment) => (he ? (seg.nameHe ?? seg.name) : seg.name.toUpperCase());
      const arc = ((2 * Math.PI * Rl) / n) * 0.92;
      const abbreviate = z.segments.some((seg) => ctx.measureText(nameOf(seg)).width > arc);
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) * 360) / n;
        const p = at(a, Rl);
        if (p.x < -50 || p.x > this.w + 50 || p.y < -20 || p.y > this.h + 20) continue;
        // i < n === z.segments.length, so this index is always in range.
        const seg = z.segments[i]!;
        // Hebrew has no upper case to shift into; applying a Latin face's
        // own idea of one to it is at best a no-op and at worst mojibake.
        const full = nameOf(seg);
        const name = abbreviate ? full.slice(0, 3) : full;
        ctx.fillText(name, p.x, p.y);
        const w = ctx.measureText(name).width;
        this.zodiacBoxes.push({ x: p.x - w / 2, y: p.y - 6, w, h: 12 });
      }
      ctx.globalAlpha = alpha;
    }

    // One hover zone per segment, whether or not its name is drawn. A drawn
    // zodiac is the piece of a figure a reader is least likely to have been
    // told anything about, and the piece most worth saying something about:
    // that it is not where it is drawn, and never could be.
    if (alpha > 0.02) {
      for (let i = 0; i < n; i++) {
        const seg = z.segments[i]!;
        const from = (i * 360) / n;
        const pts: Vec[] = [];
        for (let k = 0; k <= 10; k++) pts.push(at(from + (k * 360) / n / 10, Rl));
        if (!pts.some((p) => onScreen(p))) continue;
        const both = seg.nameHe ? (he ? `${seg.nameHe} · ${seg.name}` : `${seg.name} · ${seg.nameHe}`) : seg.name;
        this.zodiacZones.push({
          id: `zodiac:${i}`,
          text: both,
          sub: seg.description ?? note,
          color: z.labelColor ?? ZODIAC_LABEL_COLOR,
          pts,
        });
      }
    }

    ctx.restore();
    return this.zodiacBoxes;
  }

  /**
   * The stars, in a band of their own outside the names. Longitude is the
   * angle round the ring exactly as it is for everything else; latitude is
   * squashed into whatever radial room `artBand` gives, north outward, and
   * clamped at the edge rather than dropped — a figure that reaches further
   * off the ecliptic than the band does (Scorpius' sting, the Hyades)
   * should still finish its own shape.
   *
   * Star sizes and line widths are screen px, not world px: like the
   * segment names, this is annotation drawn *on* the figure rather than
   * part of its geometry, and it should stay legible at whatever zoom the
   * ring is being read at.
   */
  private drawConstellations(
    f: Frame,
    geom: ZodiacGeometry,
    view: {
      cx: number;
      cy: number;
      R2: number;
      alpha: number;
      labelAlpha: number;
      at: (lon: number, r: number) => Vec;
      onScreen: (p: Vec, pad?: number) => boolean;
    },
  ): void {
    const ring = this.ring;
    const con = ring?.cfg.constellations;
    if (!ring || !con) return;
    const ctx = this.ctx;
    const artBand = geom.artBand * this.camera.zoom;
    const mid = view.R2 + artBand / 2;
    // 0.92, so a star pinned at the latitude limit still sits inside the
    // band rather than exactly on the line the eye reads as its edge
    const half = (artBand / 2) * 0.92;
    const span = con.latitudeSpan ?? DEFAULT_LATITUDE_SPAN;
    const shift = ring.lonOffset(f);
    const starColor = con.starColor ?? CONSTELLATION_STAR_COLOR;
    const lineColor = con.color ?? CONSTELLATION_LINE_COLOR;

    for (const fig of con.figures) {
      const pts = fig.stars.map(([lon, lat]) =>
        view.at(lon + shift, mid + Math.max(-1, Math.min(1, lat / span)) * half),
      );
      if (!pts.some((p) => view.onScreen(p, 60))) continue;

      // The art keeps the names' alpha, not the ring lines': a ring dimmed
      // to a quarter in the outer views still reads as a circle, while
      // stars dimmed to a quarter are simply not there.
      ctx.globalAlpha = view.labelAlpha * 0.85;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const path of fig.paths)
        path.forEach((si, k) => {
          const p = pts[si]!;
          if (k === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
      ctx.stroke();

      ctx.fillStyle = starColor;
      fig.stars.forEach(([, , mag], i) => {
        const p = pts[i]!;
        // first magnitude reads at ~2.2px and fifth at ~0.8px: what makes a
        // pattern recognisable is the bright stars standing out from the
        // rest, not how big any of them is
        const r = Math.max(0.8, 2.6 - 0.4 * mag);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, FULL_CIRCLE);
        ctx.fill();
      });

      // the figure's own name, out at the rim, where it can be read against
      // the sign name sitting further in — which is the whole point of
      // drawing the two on one ring
      if (con.labels ?? true) {
        // a mean direction, not a mean number: Pisces straddles 0°
        let sx = 0;
        let sy = 0;
        for (const [lon] of fig.stars) {
          sx += Math.cos(lon * DEG);
          sy += Math.sin(lon * DEG);
        }
        const meanLon = Math.atan2(sy, sx) / DEG + shift;
        const p = view.at(meanLon, view.R2 + artBand + 9);
        if (view.onScreen(p, 0)) {
          ctx.globalAlpha = view.labelAlpha * 0.85;
          ctx.fillStyle = lineColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = (ring.cfg.font ?? { css: '600 9.5px system-ui, sans-serif', px: 9.5 }).css;
          const text = ring.cfg.language === 'he' ? fig.nameHe : fig.name;
          ctx.fillText(text, p.x, p.y);
          const w = ctx.measureText(text).width;
          this.zodiacBoxes.push({ x: p.x - w / 2, y: p.y - 6, w, h: 12 });
        }
      }

      const shown = pts.filter((p) => view.onScreen(p, 60));
      if (shown.length > 1)
        this.zodiacZones.push({
          id: `constellation:${fig.code}`,
          text: `${fig.name} · ${fig.nameHe}`,
          sub: con.note ?? CONSTELLATION_NOTE,
          color: starColor,
          pts: shown,
        });
    }
    ctx.globalAlpha = view.alpha;
  }

  /**
   * Hand the ring's hover zones to the controller, after Scene.draw() has
   * had its own `begin()` — which is why this is a step of its own rather
   * than something drawZodiac() does as it draws. Registering them last
   * also settles every tie in the scene's favour: a reading's tick sits
   * *on* the band, and pointing at it should explain the reading.
   */
  markZodiacHover(hover: HoverController | undefined): void {
    if (!hover) return;
    for (const zone of this.zodiacZones) hover.mark(zone.pts, zone.text, zone.sub, zone.color, zone.id);
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
    /** the ring's names' own alpha - see drawZodiac's `labelAlpha` */
    zodiacLabelAlpha?: number;
    extraObstacles?: Box[];
    backgroundTime?: number;
    beforeScene?: () => void;
    afterScene?: (labels: Label[]) => void;
  }): void {
    const ref = resolvePoint(opts.ref, opts.f);
    this.drawBackground(opts.backgroundTime ?? performance.now());
    this.drawZodiac(opts.f, ref, {
      alpha: opts.zodiacAlpha,
      labels: opts.zodiacLabels,
      labelAlpha: opts.zodiacLabelAlpha,
      scene: opts.scene,
    });
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
      // what a reading whose own point has left the frame pins its name to
      bounds: { width: this.w, safeBottom: this.safeBottom || this.h },
    });
    this.markZodiacHover(opts.hover);
    opts.hover?.update(opts.pointer);
    opts.afterScene?.(labels);
    this.drawLabels(labels, opts.theme, opts.extraObstacles);
    if (opts.hover) opts.hover.drawHighlight(this.ctx, opts.theme.ink);
  }
}

/** One hoverable piece of the ring, in screen space - see `zodiacZones`. */
interface ZodiacZone {
  id: string;
  text: string;
  sub: string;
  color: string;
  pts: Vec[];
}

/** A Stage takes either a ring the figure built (so its `inner`/`outer`
 * Scalars and what gets drawn can't disagree) or a plain config to wrap. */
function toRing(z: ZodiacConfig | ZodiacRing | false | undefined): ZodiacRing | null {
  if (!z) return null;
  return z instanceof ZodiacRing ? z : new ZodiacRing(z);
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
  /** what the '0' key resets the view to. Without this, it restores the
   * zoom and pan the camera had when wireCamera() was called — fine for a
   * figure whose frame never changes, wrong for one that re-fits on resize
   * or has its own "reset view" button, which should be this callback. */
  onReset?: () => void;
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
        if (opts.onReset) opts.onReset();
        else {
          camera.zoom = resetTo.zoom;
          camera.pan.x = resetTo.pan.x;
          camera.pan.y = resetTo.pan.y;
        }
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
 * Keep a figure sized to its element: calls `onResize` whenever the element's
 * box changes, and once immediately so a caller doesn't also have to.
 *
 * It exists mostly for the case that's easy to get wrong. An element with no
 * layout yet — inside a `display: none` tab, an unopened `<details>`, or
 * simply not laid out at the moment the component initialises — can't be
 * measured, and `Stage.resize()` says so by returning `false` rather than
 * rendering a blank figure. A caller that ignores that ends up with a
 * permanently empty canvas; here it's simply the state the observer is
 * already waiting for, since gaining a size is itself a resize and fires
 * this again. `onResize` may return `false` to say "still not measurable,"
 * which is only used to skip the redundant work a caller would otherwise do.
 *
 * Window resizes are watched too: a move to a monitor with a different
 * devicePixelRatio changes the backing store a figure needs without
 * changing its CSS box at all, so a ResizeObserver alone would miss it.
 */
export function wireResize(target: Element, onResize: () => boolean | void): () => void {
  let disposed = false;
  const run = () => {
    if (!disposed) onResize();
  };
  const ro = new ResizeObserver(run);
  ro.observe(target);
  window.addEventListener('resize', run);
  run();
  return () => {
    disposed = true;
    ro.disconnect();
    window.removeEventListener('resize', run);
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
