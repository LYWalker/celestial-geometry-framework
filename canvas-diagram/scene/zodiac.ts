/**
 * The ring of named segments at a figure's edge — the zodiac in the Rambam
 * figures, anything divided into even arcs elsewhere — as an object rather
 * than a number, because two different things need to agree about where it
 * is: Stage, which draws it, and the figure itself, whose dial lines reach
 * out to it and whose `resize({ fitRadius })` has to frame it.
 *
 * It sizes itself. Give it segments (and, if you like, `padding`) and it
 * sits just outside whatever the Scene actually reaches, so a figure that
 * grows a shell, gains an object or changes its distance scale doesn't also
 * have to restate a radius — `Scene.extent()` already knows the answer.
 *
 * Declare it before the scene, so lines can reach to it as they're built:
 *
 *   const ring = new ZodiacRing({ segments: MAZALOT, center: earth });
 *   scene.add(new Connector({ ..., toward: sunLongitude, length: ring.outer }));
 *   ring.fitTo(scene);
 *   const stage = new Stage({ canvas, zodiac: ring });
 *   ...
 *   stage.resize({ fitRadius: ring.edge(f) + 8 });
 *
 * `ring.inner`/`ring.outer` are ordinary Scalars — `(f) => number` — so
 * anywhere this kit takes a Scalar (a Connector's `length`, a Sphere's
 * `radius`, an Angle's) can be pointed at the ring directly. A line drawn
 * out to the ring doesn't inflate the ring it's drawn to: while the ring is
 * measuring the scene those Scalars read 0, so the measurement sees the
 * line collapsed onto its own start point rather than the ring chasing
 * itself a little further out every frame.
 */

import type { Vec } from '../geometry.js';
import type { Face } from '../labels.js';
import type { ConstellationFigure } from './constellations.js';
import type { Scene } from './scene.js';
import { ORIGIN, resolvePoint, resolveScalar, type Frame, type PointLike, type Scalar } from './types.js';

export interface ZodiacSegment {
  name: string;
  nameHe?: string;
  /** what the hover tooltip says about this segment in particular, under
   * its name. Defaults to the ring's own `note`. */
  description?: string;
}

/**
 * The stars themselves, drawn in a band of their own outside the names —
 * for a ring that is standing in for the sky rather than for a dial.
 *
 * Worth knowing before turning it on: the constellations are not the signs.
 * A sign is an even thirtieth of the circle counted from the equinox; a
 * constellation is a patch of stars, of whatever width it happens to be,
 * and the two have been sliding apart for two thousand years. Drawing both
 * on the same ring shows that — which is the reason to do it, and the
 * reason the art is not squeezed into the same band as the names.
 */
export interface ZodiacConstellations {
  /** the figures to draw — ZODIAC_FIGURES, for the usual twelve */
  figures: readonly ConstellationFigure[];
  /** radial room for the art, world px, outside the band of names.
   * Default: twice the name band. */
  band?: number;
  /**
   * How many degrees of ecliptic latitude the art band spans, either side
   * of the ecliptic; a star further off than this is drawn at the edge
   * rather than dropped. The figures are squashed radially by whatever
   * ratio this makes against the ring's own degrees-per-pixel — unavoidable
   * on a ring (Scorpius is 25° long and 21° deep, and the band is nothing
   * like as deep as it is long), and the reason to keep the number here
   * rather than buried: it is the one knob that trades "recognisable
   * shape" against "how much rim the figure can spare." Default 20.
   */
  latitudeSpan?: number;
  /** degrees added to every star's J2000 longitude. Pass
   * `(f) => PRECESSION_DEG_PER_DAY * daysSinceJ2000(f.t)` for a figure with
   * a clock on it, and the stars drift against the signs as it runs.
   * Default 0 — the stars where they stood in 2000. */
  lonOffset?: Scalar;
  /** the lines joining the stars */
  color?: string;
  /** the stars */
  starColor?: string;
  /** name each figure, out at the rim. Default true. */
  labels?: boolean;
  /**
   * Draw them at all. Default true. This is config rather than a draw-time
   * flag because it changes the ring's *size* — `edge` grows by `band`
   * when the stars are on — and a figure toggling it has to re-fit itself
   * either way (see `ZodiacRing.showConstellations`, which is the handle
   * for exactly that).
   */
  show?: boolean;
  /** what the hover says under a figure's name */
  note?: string;
}

export interface ZodiacConfig {
  /**
   * the ring's inner radius, world px — usually the outermost sphere's.
   * Omit it (or pass `'auto'`, the default) to size the ring to the scene
   * instead: `padding` world px outside the furthest thing the Scene draws.
   */
  radius?: number | 'auto';
  /** clear world px between the furthest thing in the scene and the ring's
   * inner edge, when `radius` is auto. Default ZODIAC_AUTO_PADDING. */
  padding?: number;
  /**
   * how an auto radius follows a scene that *moves*:
   *
   * - `'frame'` (default) — re-measured every frame, so the ring tracks the
   *   scene exactly. Right for a figure whose reach is set by fixed
   *   geometry (a nest of shells), where the measurement is the same number
   *   every frame anyway.
   * - `'grow'` — the high-water mark: the ring opens to the furthest the
   *   scene has *ever* reached and never pulls back in. Right for an orrery,
   *   where the outermost planet's distance swings with its eccentricity
   *   and a frame-by-frame ring would breathe in and out around it. A
   *   figure that doesn't want even that one settling-in can warm the mark
   *   before its first draw with `warm()`.
   *
   * `'grow'` keeps whatever it is given, so it is only as good as the
   * moments it sees: a figure whose Frame carries several amounts must be
   * sure any it warms with are *combinations it can actually show*. An
   * orrery warmed with "the shells half-faded-in" and "the camera still on
   * the sun" — two things that never happen at once, though each happens —
   * measured a reach no view of it ever has, and wore that ring for good.
   *
   * Ignored when `radius` is a number.
   */
  fit?: 'frame' | 'grow';
  /** how wide the band of names is, world px. Default 18% of the radius. */
  band?: number;
  segments: ZodiacSegment[];
  /** which name each segment is drawn under: its own, or its `nameHe`.
   * Hebrew is drawn as it is written rather than upper-cased, which the
   * script has no notion of. Default 'en'. */
  language?: 'en' | 'he';
  font?: Face;
  /** the face for `language: 'he'` — a Latin face set for 9.5px small-caps
   * makes a poor job of Hebrew. Defaults to `font`. */
  fontHe?: Face;
  /** the stars, optionally. See ZodiacConstellations. */
  constellations?: ZodiacConstellations | false;
  /**
   * What the hover tooltip says about the ring, under whichever segment's
   * name is being pointed at. The default is the one thing about a drawn
   * zodiac that is always a lie and always worth saying out loud.
   */
  note?: string;
  /** the ring's own lines: its two edges and the dial marks between them.
   * Faint by nature — it is a backdrop, and the figure is what is being
   * read against it. */
  color?: string;
  /** the segment names. Separate from `color`, and by default much less
   * faint, because they are not backdrop: a ring line at a tenth of full
   * strength still reads as a ring, while a *word* at a tenth of full
   * strength is simply unreadable. Defaults to `color` for a ring that
   * genuinely wants both the same. */
  labelColor?: string;
  /** the world point the ring is centred on. Default the origin — a zodiac
   * is a fixed backdrop, not tied to whatever the camera's `ref` happens to
   * be (which is why this is its own field rather than reusing `ref`). */
  center?: PointLike;
}

/** What a ring says about itself when there is nothing more particular to
 * say: that the one thing it cannot draw honestly is its distance. */
export const ZODIAC_NOTE =
  'Infinitely far off — brought close here only so a direction can be read against it. The angle is all it means; the distance is not to scale, and could not be.';

/** What a constellation figure says about itself: why it is not sitting
 * over the sign that bears its name. */
export const CONSTELLATION_NOTE =
  'The stars themselves. They no longer stand over the sign named after them: the signs are counted from the equinox, which creeps back about a degree every seventy-two years.';

/** The ring's own lines, when the config doesn't say. Faint, but not so
 * faint that a dimmed ring disappears: it is a backdrop that still has to
 * read as a circle. */
export const ZODIAC_COLOR = 'rgba(158,176,222,0.32)';
/** The segment names, when the config doesn't say — much brighter than the
 * lines. A ring line at a third strength still reads as a ring; a *word* at
 * a third strength is simply unreadable, and these are 9px words. */
export const ZODIAC_LABEL_COLOR = 'rgba(223,231,251,0.92)';
/** The stars, and the lines joining them. */
export const CONSTELLATION_STAR_COLOR = 'rgba(232,236,250,0.8)';
export const CONSTELLATION_LINE_COLOR = 'rgba(150,180,235,0.34)';

/** Where the ring actually is at some moment — all world px, all resolved
 * (an auto radius included). */
export interface ZodiacGeometry {
  /** the ring's inner radius */
  radius: number;
  /** how wide the band of names is */
  band: number;
  /** the outer edge of the band of names, `radius + band` — what a dial
   * line drawn out to the ring reaches */
  outer: number;
  /** radial room for the constellation art outside `outer`; 0 when there
   * is none to draw */
  artBand: number;
  /** the outermost radius anything is actually drawn at, `outer + artBand`
   * — what a figure should frame itself to */
  edge: number;
  /** the world point it's centred on */
  center: Vec;
}

/** How much clear space an auto-sized ring leaves between the furthest
 * thing in the scene and its own inner edge, world px. Roughly a label's
 * height: enough that the outermost object's own name isn't crowded by the
 * ring, without pushing the ring off the frame. */
export const ZODIAC_AUTO_PADDING = 28;

/** See `ZodiacConstellations.latitudeSpan`. Twenty degrees takes in every
 * star of the twelve figures but the deep tails of Scorpius, Sagittarius
 * and the Hyades, which are drawn at the band's edge instead. */
export const DEFAULT_LATITUDE_SPAN = 20;

export class ZodiacRing {
  private scene: Scene | null = null;
  /** the answer for one Frame, memoised on that Frame's identity the same
   * way Sphere/Angle memoise theirs: several things ask for it each frame
   * (the draw, the dial lines' lengths, a figure's own fit arithmetic) and
   * measuring the scene walks every object in it */
  private memoFrame: Frame | null = null;
  private memo: ZodiacGeometry | null = null;
  /** the furthest an auto radius has ever been asked to reach, for `fit: 'grow'` */
  private highWater = 0;
  /** true while measuring the scene — see this file's own header: it's what
   * keeps a line drawn out to the ring from pushing the ring outward */
  private measuring = false;
  /** set by freeze(): the radius the ring keeps, whatever the scene does
   * next. Its *centre* still moves — see freeze() */
  private frozenRadius: number | null = null;

  constructor(public cfg: ZodiacConfig) {}

  /** Which Scene an auto radius measures. Stage does this for you with the
   * Scene it renders; call it yourself for a ring you want to ask about
   * (`ring.outer(f)`, for a `fitRadius`) before the first draw. */
  fitTo(scene: Scene): this {
    // Pointing at the *same* Scene again is not a change, and must not be
    // treated as one. Stage.render() calls this every single frame with the
    // Scene it is drawing, so a fitTo() that always lifted freeze() meant a
    // frozen ring silently thawed on the first render after it was frozen —
    // and a `fit: 'grow'` ring then spent the rest of the session creeping
    // out to the largest reach any *transitional* frame ever had, which is
    // exactly the moment its own centre is somewhere else and everything
    // measures further away than it ever really is. That is the trap `fit`
    // warns about, arrived at without the figure doing anything wrong.
    if (this.scene === scene) return this;
    this.scene = scene;
    this.frozenRadius = null;
    this.memoFrame = null;
    return this;
  }

  /** What the ring is centred on, when that isn't known until the scene is
   * built (an orrery's ring belongs to whoever is watching, which is a
   * blend of two of the scene's own objects). Same effect as passing
   * `center` in the config. */
  centerOn(center: PointLike): this {
    this.cfg.center = center;
    this.memoFrame = null;
    return this;
  }

  /**
   * Stop measuring, and keep the size it has now — for a figure whose ring
   * should be a fixed backdrop rather than something that follows the
   * picture around. Its *centre* still resolves every frame, so a ring that
   * belongs to "whoever is watching" still travels with them; only the
   * radius is fixed.
   *
   * The useful shape is `warm(...).freeze()` with `fit: 'grow'`: measure
   * every view the figure can show, keep the largest, and stop. That's a
   * ring big enough for all of them and motionless in each — where a
   * per-frame ring, honest as it is, breathes as the picture inside it
   * grows and shrinks, which reads as the sky moving.
   *
   * `fitTo()` and `set()` lift it; there's no separate unfreeze.
   */
  freeze(): this {
    this.frozenRadius = this.memo?.radius ?? (this.highWater || null);
    return this;
  }

  /**
   * Turn the stars on or off. It changes what the ring *measures* to, not
   * just what it paints, so the caller should re-fit its own frame after
   * calling this — `resize({ fitRadius: ring.edge(f) + … })` — or the art
   * will be drawn off the edge of the canvas. The ring's own inner radius
   * is untouched, frozen or not: the stars ride outside everything the
   * figure is measured against.
   */
  showConstellations(on: boolean): this {
    const c = this.cfg.constellations;
    if (!c) return this;
    this.cfg.constellations = { ...c, show: on };
    this.memoFrame = null;
    this.memo = null;
    return this;
  }

  /** Which of a segment's two names is drawn. Nothing about the ring's
   * geometry depends on it, so nothing is re-measured. */
  setLanguage(language: 'en' | 'he'): this {
    this.cfg.language = language;
    return this;
  }

  /** Retheme or resize at runtime — a light/dark toggle, a different set of
   * segments — discarding the measurement so the next frame re-derives it. */
  set(cfg: ZodiacConfig): void {
    this.cfg = cfg;
    this.memoFrame = null;
    this.memo = null;
    this.highWater = 0;
    this.frozenRadius = null;
  }

  /**
   * Where the ring sits at this moment. Null only when an auto ring has no
   * Scene to measure yet (before `fitTo()`/the first render) or while the
   * ring is itself mid-measurement — both of which `inner`/`outer` below
   * read as "no size to report," i.e. 0.
   */
  geometry(f: Frame): ZodiacGeometry | null {
    const z = this.cfg;
    if (this.measuring) return null;
    if (this.memoFrame === f && this.memo) return this.memo;

    const center = resolvePoint(z.center ?? ORIGIN, f);
    let radius: number;
    if (this.frozenRadius !== null) {
      // frozen: the size stays, the centre still moves with the figure
      radius = this.frozenRadius;
    } else if (typeof z.radius === 'number') {
      radius = z.radius;
    } else {
      // No Scene yet (a resize before the first draw): keep the last known
      // ring rather than reporting a zero-radius one nothing can use.
      if (!this.scene) return this.memo;
      this.measuring = true;
      let measured: number;
      try {
        measured = this.scene.extent(f, { center });
      } finally {
        this.measuring = false;
        // Anything resolved during the measurement saw `inner`/`outer` as 0
        // (that's what keeps a dial line from pushing its own ring out) and
        // will have memoised that on this Frame — so those provisional
        // answers have to go before the same frame draws itself.
        this.scene.invalidateResolved();
      }
      radius = measured + (z.padding ?? ZODIAC_AUTO_PADDING);
      if (z.fit === 'grow') {
        radius = Math.max(radius, this.highWater);
        this.highWater = radius;
      }
    }
    const band = z.band ?? radius * 0.18;
    const outer = radius + band;
    const artBand = z.constellations && z.constellations.show !== false ? (z.constellations.band ?? band * 2) : 0;
    const geom: ZodiacGeometry = {
      radius,
      band,
      outer,
      artBand,
      edge: outer + artBand,
      center,
    };
    this.memoFrame = f;
    this.memo = geom;
    return geom;
  }

  /** The ring's inner radius as a Scalar — `radius: ring.inner` for
   * anything that should sit exactly on it. 0 before the ring has a size. */
  readonly inner = (f: Frame): number => this.geometry(f)?.radius ?? 0;

  /** The outer edge of the band of names as a Scalar — `length: ring.outer`
   * for a dial line drawn from somewhere inside out to the ring. 0 before
   * the ring has a size, which simply draws nothing. */
  readonly outer = (f: Frame): number => this.geometry(f)?.outer ?? 0;

  /** The outermost radius the ring actually draws at — `outer`, plus the
   * constellation art when there is any. This, not `outer`, is what a
   * figure's own `resize({ fitRadius })` should frame to, or turning the
   * stars on will push them off the edge of the canvas. */
  readonly edge = (f: Frame): number => this.geometry(f)?.edge ?? 0;

  /** How far off the ecliptic the art band reaches, in degrees — resolved
   * with its default, for a figure that wants to say so in its own caption. */
  latitudeSpan(): number {
    return this.cfg.constellations ? (this.cfg.constellations.latitudeSpan ?? DEFAULT_LATITUDE_SPAN) : 0;
  }

  /** The precession offset to apply to the stars this frame, in degrees. */
  lonOffset(f: Frame): number {
    const c = this.cfg.constellations;
    return c && c.lonOffset !== undefined ? resolveScalar(c.lonOffset, f) : 0;
  }

  /**
   * Measure these moments now, for `fit: 'grow'` — a figure whose outermost
   * object swings (an eccentric orbit, a distance-scale transition) can hand
   * over a sweep of representative Frames before its first draw and have the
   * ring open at its final size instead of creeping outward as the figure
   * plays. Nothing is drawn; this is only the arithmetic a later frame would
   * have done anyway.
   *
   * Every Frame passed here must be one the figure can really be in — see
   * `fit`. Sweeping each amount independently is the easy way to invent a
   * moment that can't happen and size the ring to it forever; sweep along
   * the *paths* the figure takes between its views instead.
   */
  warm(frames: Iterable<Frame>): this {
    for (const f of frames) this.geometry(f);
    return this;
  }
}
