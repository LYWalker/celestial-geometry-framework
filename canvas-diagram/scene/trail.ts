/**
 * A rolling window of a target's past positions, redrawn every frame in
 * *today's* reference frame — so switching which point the camera holds
 * still bends the trail into its new shape in front of you rather than
 * requiring it to be redrawn from scratch. That is Orrery.astro's own trail
 * trick (`drawTrails`): each historical sample's position relative to
 * *its own* reference point, at *its own* past moment, is what gets plotted
 * — under the *current* mode blend, since `relativeTo` is re-resolved at
 * that past moment using every other field of today's Frame, only `t`
 * itself stepped back. A Trail is not a Positioned — it has no one place —
 * so it isn't something a Sphere can centre on; it exists only to be added
 * to a Scene and drawn.
 *
 * Points are joined with a Catmull-Rom curve (converted to cubic Béziers),
 * not straight segments, specifically so `step` doesn't have to be retuned
 * against how far a diagram lets its camera zoom in: a straight chord's
 * *screen* length grows with zoom even though its *world* length is fixed,
 * so a `step` that looks smooth at the fitted view visibly facets once
 * zoomed past whatever zoom it happened to be tuned against — an invisible
 * coupling between this file and wireCamera's `maxZoom`. A curve re-fits
 * itself to the current transform every frame, so `step` only ever has to
 * answer one question: how many degrees of the target's own motion is one
 * sample allowed to skip (see `step`'s own doc).
 */

import type { Vec } from '../geometry.js';
import { type Frame, type Meta, type PointLike, SceneObject, resolvePoint } from './types.js';

/** A span/step combination asking for more samples than this is coerced
 * down to it (by coarsening the effective step) rather than allowed to
 * allocate and walk an unbounded array once per reseed. */
const MAX_TRAIL_SAMPLES = 2000;

export interface TrailConfig extends Meta {
  /** the thing whose past positions are drawn */
  target: PointLike;
  /** positions are plotted relative to this point, re-evaluated at each
   * past moment too — pass the object the draw call's `ref` comes from, so
   * the trail bends into whatever frame is current. Omit for a trail
   * plotted in raw, un-recentred world space. */
  relativeTo?: PointLike;
  /** how far back to draw, in the frame clock's own units */
  span: number;
  /**
   * spacing between samples along that span — with curve interpolation
   * this is "how many degrees of the target's motion can one sample skip,"
   * not "how straight does one segment have to look." Something turning at
   * 210°/s and a `step: 0.05` skips ~10°/sample, which stays a visually
   * smooth curve at any zoom a figure normally allows; you'd only need to
   * tighten it further for a target that changes direction very sharply
   * within a single sample, which a slow, steady orbit never does.
   */
  step: number;
  /** stepped-alpha bands, oldest faintest — a fading tail without a
   * per-pixel gradient. Default 6. */
  bands?: number;
  lineWidth?: number;
  /**
   * Which Frame keys (besides `t`) this trail's `target`/`relativeTo`
   * actually read. A change to any *other* key would otherwise still throw
   * away every cached sample and rebuild the whole span — correct (a
   * Scalar the trail doesn't depend on can't have changed anything it
   * drew), but during a *continuously animated* field (a mode-transition
   * amount, say) that a trail genuinely doesn't read, it's a full rebuild
   * every single frame for no reason. Pass `[]` for a trail that only
   * depends on the clock (most of them). Omit to depend on everything,
   * which is always correct, just not always cheap.
   */
  dependsOn?: readonly string[];
}

interface Sample {
  t: number;
  rel: Vec;
}

/**
 * Draw a smooth curve through `samples[fromIdx..toIdx]` (Catmull-Rom,
 * converted to cubic Béziers) — but reaching one point past each end of the
 * range, into the full array, for its tangent, so adjacent bands (drawn as
 * separate sub-ranges, for the stepped-alpha fade) join with continuous
 * curvature instead of a visible kink at the handoff.
 */
function smoothSegment(ctx: CanvasRenderingContext2D, samples: Sample[], fromIdx: number, toIdx: number): void {
  const n = samples.length;
  // fromIdx/toIdx are always valid indexes into `samples` (callers derive
  // them from `samples.length` itself), and the clamped i-1/i+2 neighbours
  // stay in [0, n-1] by construction — the `!`s just satisfy
  // noUncheckedIndexedAccess, which can't see either invariant.
  ctx.moveTo(samples[fromIdx]!.rel.x, samples[fromIdx]!.rel.y);
  for (let i = fromIdx; i < toIdx; i++) {
    const p0 = samples[Math.max(0, i - 1)]!.rel;
    const p1 = samples[i]!.rel;
    const p2 = samples[i + 1]!.rel;
    const p3 = samples[Math.min(n - 1, i + 2)]!.rel;
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

export class Trail extends SceneObject<TrailConfig> {
  readonly kind = 'trail' as const;

  private readonly effectiveStep: number;
  private samples: Sample[] = [];
  /** a fingerprint of the Frame fields this trail depends on (see
   * `dependsOn`) — if any of them changed, every cached sample was walked
   * under a stale mode and must be re-derived */
  private modeKey = '';
  // Frame-identity memo for samplesForRender()'s own result, same idea as
  // Sphere/Angle/Connector's memoisation (see their own comments) but for a
  // different reason: `draw()` and `points()` are two independent public
  // entry points that Scene's trail case calls once each, every frame, and
  // each used to redo samplesForRender()'s own work from scratch — which
  // isn't just the array-copy, it's an *uncached* extra sample computed via
  // pushSample() nearly every frame (samplesForRender's own doc explains
  // why: the cache's step grid essentially never lands exactly on `f.t`).
  // That pushSample() call resolves the whole target/relativeTo chain
  // through a synthetic per-sample Frame object, which — because
  // Sphere/Angle/Connector memoise on Frame *identity*, not value — misses
  // every one of those memos even though the synthetic Frame's fields are
  // identical to a Frame already resolved elsewhere this same frame.
  // Computing it once and caching by `f`'s own identity halves that cost.
  private memoRenderFrame: Frame | null = null;
  private memoRenderSamples: Sample[] | null = null;

  constructor(cfg: TrailConfig) {
    super(cfg);
    if (!(cfg.step > 0) || !Number.isFinite(cfg.step))
      throw new Error(
        `canvas-diagram Trail "${cfg.id}": step must be a positive, finite number (got ${cfg.step}) — zero or negative would loop forever building samples.`,
      );
    if (!(cfg.span > 0) || !Number.isFinite(cfg.span))
      throw new Error(`canvas-diagram Trail "${cfg.id}": span must be a positive, finite number (got ${cfg.span}).`);

    const n = Math.ceil(cfg.span / cfg.step);
    if (n > MAX_TRAIL_SAMPLES) {
      this.effectiveStep = cfg.span / MAX_TRAIL_SAMPLES;
      console.warn(
        `canvas-diagram Trail "${cfg.id}": span/step would need ${n} samples; capped to ${MAX_TRAIL_SAMPLES} by coarsening step to ${this.effectiveStep.toFixed(4)}. Lower span or raise step to silence this.`,
      );
    } else {
      this.effectiveStep = cfg.step;
    }
  }

  private modeKeyOf(f: Frame): string {
    const keys = this.cfg.dependsOn;
    let s = '';
    if (keys) {
      for (const k of keys) s += `${k}:${f[k]};`;
    } else {
      for (const k in f) if (k !== 't') s += `${k}:${f[k]};`;
    }
    return s;
  }

  /** One sample: the target's position at past moment `t`, already reduced
   * relative to `relativeTo` at that same moment — computed once here, at
   * push time, never again. Sound because `ensureSamples` clears the whole
   * cache (via `modeKey`) whenever a Frame field this trail depends on
   * changes, so for as long as a sample survives in the cache its relative
   * position is, by construction, still correct. */
  private pushSample(f: Frame, t: number): Sample {
    const pf: Frame = { ...f, t };
    const p = resolvePoint(this.cfg.target, pf);
    if (this.cfg.relativeTo === undefined) return { t, rel: { x: p.x, y: p.y } };
    const r = resolvePoint(this.cfg.relativeTo, pf);
    return { t, rel: { x: p.x - r.x, y: p.y - r.y } };
  }

  private ensureSamples(f: Frame): void {
    const key = this.modeKeyOf(f);
    if (key !== this.modeKey) {
      this.modeKey = key;
      this.samples = [];
    }

    const step = this.effectiveStep;
    const span = this.cfg.span;
    const last = this.samples[this.samples.length - 1];
    if (!last || f.t < last.t || f.t - last.t > span) {
      this.samples = [];
      for (let s = f.t - span; s <= f.t; s += step) this.samples.push(this.pushSample(f, s));
      return;
    }

    let next = last.t + step;
    while (next <= f.t) {
      this.samples.push(this.pushSample(f, next));
      next += step;
    }
    const cutoff = f.t - span;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop]!.t < cutoff) drop++;
    if (drop) this.samples.splice(0, drop);
  }

  /** `this.samples`, plus one extra sample at exactly `f.t` when the cache's
   * own step grid doesn't already land there — computed once per Frame
   * *object* (see `memoRenderFrame` above) rather than never stored, so it
   * can't perturb `ensureSamples`'s step/cutoff bookkeeping but also isn't
   * paid for twice when both `draw()` and `points()` are called this frame.
   * Without the extra sample at all, the drawn curve would only ever reach
   * whatever step-quantised instant is ≤ `f.t` (up to one whole `step`
   * short), leaving a visible gap between the trail's end and the body it's
   * trailing, which itself is always drawn at the exact current instant. */
  private samplesForRender(f: Frame): Sample[] {
    if (this.memoRenderFrame === f && this.memoRenderSamples) return this.memoRenderSamples;

    const last = this.samples[this.samples.length - 1];
    const result = !last || last.t === f.t ? this.samples : [...this.samples, this.pushSample(f, f.t)];
    this.memoRenderFrame = f;
    this.memoRenderSamples = result;

    // Re-resolve the target (and relativeTo) chain once against the *real*
    // Frame object, now that sampling is done with it — every sample above
    // was walked against a synthetic per-instant Frame (see pushSample),
    // which leaves Sphere/Angle/Connector's own Frame-identity memos primed
    // for that synthetic object, not `f`. Left alone, the real draw pass
    // that follows (a body drawn from this same target, an Angle that
    // sights on it, and so on) would find every one of those memos stale
    // against `f` and pay for a full recompute it would otherwise have
    // gotten for free. This is one extra resolution, not free, but far
    // cheaper than every downstream reader missing its own cache.
    resolvePoint(this.cfg.target, f);
    if (this.cfg.relativeTo !== undefined) resolvePoint(this.cfg.relativeTo, f);

    return result;
  }

  /** The world-pass-local points currently drawn (post `relativeTo`
   * subtraction) — so Scene can register a hover zone against the same
   * geometry that's actually on screen, without re-deriving it itself.
   * Copied out of the sample cache, not handed back by reference — same
   * hazard, same fix as Sphere.position()/centerAt(): `s.rel` is the same
   * Vec object `ensureSamples`/`pushSample` store and reuse frame to frame,
   * and a caller mutating what points() returns would otherwise corrupt it. */
  points(f: Frame): Vec[] {
    this.ensureSamples(f);
    return this.samplesForRender(f).map((s) => ({ x: s.rel.x, y: s.rel.y }));
  }

  /** Draw the trail. Call inside the caller's applyCamera block, alongside
   * everything else in the world pass — its points are already relative to
   * `relativeTo`, which is what makes them land correctly under a transform
   * centred on the *current* reference point. `alpha` multiplies every
   * band's own fade (Scene passes the object's resolved `opacity` here,
   * since the per-band alpha this method sets internally would otherwise
   * silently override an ambient `ctx.globalAlpha` rather than combine with it). */
  draw(ctx: CanvasRenderingContext2D, f: Frame, zoom: number, alpha = 1, color?: string): void {
    this.ensureSamples(f);
    const samples = this.samplesForRender(f);
    const n = samples.length;
    if (n < 2) return;

    const bands = this.cfg.bands ?? 6;
    ctx.save();
    ctx.lineWidth = (this.cfg.lineWidth ?? 1.4) / zoom;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color ?? this.cfg.color ?? '#fff';
    for (let band = 0; band < bands; band++) {
      const from = Math.floor((band * (n - 1)) / bands);
      const to = Math.floor(((band + 1) * (n - 1)) / bands);
      if (to <= from) continue;
      ctx.globalAlpha = alpha * 0.55 * ((band + 1) / bands);
      ctx.beginPath();
      smoothSegment(ctx, samples, from, to);
      ctx.stroke();
    }
    ctx.restore();
  }
}
