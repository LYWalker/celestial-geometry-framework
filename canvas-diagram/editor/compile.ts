/**
 * A document, turned into the live objects the scene layer draws.
 *
 * This is the half of the round trip that has to be exactly right, because it
 * is what the editor shows you: if compiling a document produced anything
 * other than what the equivalent hand-written figure produces, the editor
 * would be a preview of a figure that does not exist. So every field goes
 * through one of the six `…Of` resolvers below and nowhere else, each of which
 * knows one of the scene layer's value unions — `Scalar`, `PointLike`,
 * `DirectionLike`, `BoolLike`, a gloss, a label direction — and there is no
 * per-field special-casing anywhere in the builders.
 *
 * Two things are worth knowing before reading it.
 *
 * **References are late.** `{ ref: 'moon' }` does not become the moon object;
 * it becomes a stand-in that looks the moon up when asked, which is at draw
 * time. That is how a document can refer forward (a sphere centred on one
 * declared after it) without the compiler needing a topological sort, and it
 * is the same late binding a module-level `const moon` gives a hand-written
 * figure. The one thing it cannot do is make a *circular* reference work, and
 * `validateDoc` catches those before we get here.
 *
 * **Nothing compiled here throws.** A bad expression, a dangling reference, a
 * sphere that the scene layer's own constructor rejects — each is caught,
 * recorded as a problem against the object it came from, and that one object
 * is left out of the scene. An editor that dies on a half-typed expression is
 * an editor you cannot type in.
 */

import type { Vec } from '../geometry.js';
import { Anchor, type AnchorConfig } from '../scene/anchor.js';
import { Angle, type AngleConfig } from '../scene/angle.js';
import { Connector, type ConnectorConfig } from '../scene/connector.js';
import { ZODIAC_FIGURES } from '../scene/constellations.js';
import { RingMarker, type RingMarkerConfig } from '../scene/marker.js';
import { Scene, type SceneItem, type SceneTheme } from '../scene/scene.js';
import { Sphere, type SphereConfig } from '../scene/sphere.js';
import type { BackgroundTheme } from '../scene/stage.js';
import { Trail, type TrailConfig } from '../scene/trail.js';
import {
  frame,
  type BodyRenderer,
  type BoolLike,
  type DirectionLike,
  type Frame,
  type PointLike,
  type Positioned,
  type Scalar,
} from '../scene/types.js';
import { ZodiacRing, type ZodiacConfig, type ZodiacConstellations } from '../scene/zodiac.js';
import {
  isExpr,
  isRef,
  isXY,
  validateDoc,
  type BoolValue,
  type DiagramDoc,
  type DirValue,
  type DocProblem,
  type NumValue,
  type ObjectDoc,
  type PointValue,
  type TextValue,
  type VecValue,
} from './doc.js';
import { Env, lateRef, type ExprProblem } from './expr.js';
import { getRenderer } from './renderers.js';

export interface CompiledFigure {
  scene: Scene;
  theme: SceneTheme;
  background: BackgroundTheme | false;
  /** the ring at the figure's edge, as an object rather than a config — so a
   * marker's radius and a sightline's length can be pointed straight at it
   * instead of restating where it is */
  zodiac: ZodiacRing | false;
  /** the point the camera holds still */
  ref: PointLike;
  /** where light comes from, for any body drawn with a lit renderer */
  light: PointLike | undefined;
  /** every object that made it into the scene, by id — how the editor gets
   * from a row in its list, or a hit test, back to a live object */
  items: Map<string, SceneItem>;
  /** structural problems (`validateDoc`) plus anything that refused to build */
  problems: DocProblem[];
  /** the expression environment, so the editor can read its problems after a
   * draw — a runtime failure only shows up once something has been drawn */
  env: Env;
  /** build this figure's Frame: the clock, plus each declared parameter */
  frameFor(t: number, params: Readonly<Record<string, number>>): Frame;
}

export interface CompileOptions {
  /**
   * The expression environment to compile against. Pass the editor's own, so
   * host-registered helpers (an ephemeris, a palette) are in scope and its
   * problem list accumulates across recompiles. A fresh one is made when this
   * is omitted, which is what a one-shot compile of a finished document wants.
   */
  env?: Env;
}

/**
 * Compile a document. Never throws: whatever could not be built is reported in
 * `problems`, and the rest of the figure is returned intact.
 */
export function compileDoc(doc: DiagramDoc, opts: CompileOptions = {}): CompiledFigure {
  const env = opts.env ?? new Env();
  const problems: DocProblem[] = validateDoc(doc);
  const items = new Map<string, SceneItem>();

  // Put every object in scope under a JavaScript-safe version of its id, so an
  // expression can write `distanceBetween(earth, moon, f)` with the same names
  // the emitted source uses. Late-bound (see `lateRef`), because the object an
  // expression names may not be built yet — or may be the very object whose
  // expression this is.
  const scopeNames: Record<string, unknown> = {};
  for (const o of doc.objects) scopeNames[varName(o.id)] = lateRef(() => items.get(o.id));
  env.registerHelpers(scopeNames);

  // Built before the objects, because they may ask it how big it is: a ring
  // reading's radius is nearly always `ringRadius(f)`, and a sightline drawn
  // out to the ring is `ringOuter(f)`. Those read off this object, which is
  // the same one Stage draws — so a tick can never sit on a different circle
  // than the one that actually appears.
  const ring = compileZodiac(doc, env, items);
  if (ring !== false) {
    env.registerHelpers({
      ring,
      ringRadius: (f: Frame) => ring.geometry(f)?.radius ?? 0,
      ringOuter: (f: Frame) => ring.geometry(f)?.outer ?? 0,
      ringEdge: (f: Frame) => ring.geometry(f)?.edge ?? 0,
    });
  } else {
    env.registerHelpers({ ring: null, ringRadius: () => 0, ringOuter: () => 0, ringEdge: () => 0 });
  }

  const scene = new Scene();
  for (const o of doc.objects) {
    try {
      const item = buildItem(o, env, items);
      items.set(o.id, item);
      scene.add(item);
    } catch (e) {
      // The scene layer's own constructors throw on the combinations they
      // refuse (a Sphere with both `plane` and `measureFrom`). Report it
      // against the object and carry on without it, rather than losing the
      // whole figure to one bad object.
      problems.push({ id: o.id, message: (e as Error).message });
    }
  }

  const refId = doc.view.refId ?? doc.objects.find((o) => o.kind === 'anchor')?.id;
  const ref: PointLike = refId !== undefined ? lateRef(() => items.get(refId)) : { x: 0, y: 0 };
  const lightId = doc.view.lightId;
  const light: PointLike | undefined =
    lightId !== undefined && lightId !== '' ? lateRef(() => items.get(lightId)) : undefined;

  const paramKeys = doc.params.map((p) => p.key);

  return {
    scene,
    theme: doc.theme as SceneTheme,
    background: doc.background,
    zodiac: ring,
    ref,
    light,
    items,
    problems,
    env,
    frameFor(t, params) {
      // Only the keys this figure declares, so a stale parameter left over in
      // the editor's state cannot quietly become a Frame key an expression
      // reads. A declared parameter with no current value reads 0, which is
      // the "off" end of every transition amount in this kit.
      const extra: Record<string, number> = {};
      for (const k of paramKeys) extra[k] = params[k] ?? 0;
      return frame(t, extra);
    },
  };
}

/* -------------------------------------------------------------------------
 * The six resolvers
 *
 * One per value union the scene layer has. Every field in every builder below
 * goes through exactly one of these, which is what keeps "what a document may
 * say" and "what the scene layer accepts" from drifting apart field by field.
 * ---------------------------------------------------------------------- */

interface Where {
  id: string;
  field: string;
}

function numOf(v: NumValue, env: Env, where: Where): Scalar {
  return isExpr(v) ? env.compile<number>(v.expr, where, 0) : v;
}

function boolOf(v: BoolValue, env: Env, where: Where): BoolLike {
  return isExpr(v) ? env.compile<boolean>(v.expr, where, false) : v;
}

function textOf(v: TextValue, env: Env, where: Where): string | ((f: Frame) => string) {
  return isExpr(v) ? env.compile<string>(v.expr, where, '') : v;
}

function pointOf(v: PointValue, env: Env, where: Where, items: Map<string, SceneItem>): PointLike {
  if (isRef(v)) return lateRef(() => items.get(v.ref));
  if (isExpr(v)) return env.compile<Vec>(v.expr, where, { x: 0, y: 0 });
  return { x: v.x, y: v.y };
}

function dirOf(v: DirValue, env: Env, where: Where, items: Map<string, SceneItem>): DirectionLike {
  if (typeof v === 'number') return v;
  if (isRef(v)) return lateRef(() => items.get(v.ref)) as Positioned;
  return env.compile<number>(v.expr, where, 0);
}

function vecOf(v: VecValue, env: Env, where: Where): Vec | ((f: Frame) => Vec) {
  if (isXY(v)) return { x: v.x, y: v.y };
  return env.compile<Vec>(v.expr, where, { x: 1, y: 0 });
}

/* -------------------------------------------------------------------------
 * Building one object
 * ---------------------------------------------------------------------- */

/**
 * Copy `value` onto `cfg` under `key`, but only when there is one.
 *
 * Under `exactOptionalPropertyTypes` an explicit `undefined` is not the same
 * as an absent key, and the scene layer reads several fields as "absent means
 * derive a default" (`Sphere.showBody` from whether `speed` is set,
 * `Anchor.at` from the origin). Writing `showBody: doc.showBody` would hand
 * those defaults an explicit `undefined` and, for the fields typed without
 * `| undefined`, would not even compile. Hence a builder that assembles a
 * plain record and one cast at the end, rather than thirty conditional
 * spreads: the cast is the honest cost of building a typed config field by
 * field, and it is paid once per kind rather than once per field.
 */
function put(cfg: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) cfg[key] = value;
}

function buildItem(o: ObjectDoc, env: Env, items: Map<string, SceneItem>): SceneItem {
  const cfg: Record<string, unknown> = {
    id: o.id,
    name: o.name,
  };
  const at = (field: string): Where => ({ id: o.id, field });

  // --- Meta, shared by every kind ---
  put(cfg, 'nameHe', o.nameHe);
  put(cfg, 'description', o.description);
  put(cfg, 'color', o.color);
  put(cfg, 'opacity', o.opacity === undefined ? undefined : numOf(o.opacity, env, at('opacity')));
  put(cfg, 'gloss', o.gloss === undefined ? undefined : textOf(o.gloss, env, at('gloss')));
  put(cfg, 'hebrewFirst', o.hebrewFirst);
  put(cfg, 'labelDir', o.labelDir === undefined ? undefined : vecOf(o.labelDir, env, at('labelDir')));
  put(cfg, 'labelFont', o.labelFont);
  put(cfg, 'labelSubFont', o.labelSubFont);
  put(cfg, 'labelRank', o.labelRank);
  put(cfg, 'labelGap', o.labelGap);
  put(cfg, 'showLabel', o.showLabel);
  put(cfg, 'excludeFromExtent', o.excludeFromExtent);
  put(cfg, 'layer', o.layer);

  switch (o.kind) {
    case 'anchor': {
      put(cfg, 'at', o.at === undefined ? undefined : pointOf(o.at, env, at('at'), items));
      put(cfg, 'marker', o.marker);
      put(cfg, 'dotSize', o.dotSize);
      return new Anchor(cfg as unknown as AnchorConfig);
    }

    case 'sphere': {
      cfg['radius'] = numOf(o.radius, env, at('radius'));
      put(cfg, 'center', o.center === undefined ? undefined : pointOf(o.center, env, at('center'), items));
      if (o.eccentric) {
        // `?? 0` rather than trusting the type: the inspector creates the
        // parent the moment either half is set, so a document is legitimately
        // half-built while someone is typing the other half.
        cfg['eccentric'] = {
          ratio: numOf(o.eccentric.ratio ?? 0, env, at('eccentric.ratio')),
          direction: dirOf(o.eccentric.direction ?? 0, env, at('eccentric.direction'), items),
        };
      }
      put(cfg, 'speed', o.speed);
      put(cfg, 'phase', o.phase);
      put(cfg, 'angle', o.angle === undefined ? undefined : numOf(o.angle, env, at('angle')));
      if (o.plane) {
        const plane: Record<string, unknown> = {
          tilt: numOf(o.plane.tilt ?? 0, env, at('plane.tilt')),
          nodes: dirOf(o.plane.nodes ?? 0, env, at('plane.nodes'), items),
        };
        put(plane, 'behindFade', o.plane.behindFade);
        cfg['plane'] = plane;
      }
      put(cfg, 'measureFrom', o.measureFrom === undefined ? undefined : pointOf(o.measureFrom, env, at('measureFrom'), items));
      put(cfg, 'showRing', o.showRing);
      put(cfg, 'showBody', o.showBody);
      put(cfg, 'markCenter', o.markCenter === undefined ? undefined : boolOf(o.markCenter, env, at('markCenter')));
      put(cfg, 'dotSize', o.dotSize);
      put(cfg, 'labelAt', o.labelAt === undefined ? undefined : dirOf(o.labelAt, env, at('labelAt'), items));
      if (o.render !== undefined) {
        const renderer = isRef(o.render)
          ? getRenderer(o.render.ref)
          : env.compileValue<BodyRenderer | undefined>(o.render.expr, at('render'), undefined);
        put(cfg, 'render', renderer);
      }
      return new Sphere(cfg as unknown as SphereConfig);
    }

    case 'angle': {
      cfg['vertex'] = pointOf(o.vertex, env, at('vertex'), items);
      cfg['from'] = dirOf(o.from, env, at('from'), items);
      cfg['to'] = dirOf(o.to, env, at('to'), items);
      cfg['radius'] = numOf(o.radius, env, at('radius'));
      put(cfg, 'short', o.short);
      put(cfg, 'clockwise', o.clockwise);
      put(cfg, 'showValue', o.showValue);
      if (o.format !== undefined) {
        put(cfg, 'format', env.compileValue<((d: number) => string) | undefined>(o.format.expr, at('format'), undefined));
      }
      put(cfg, 'lineWidth', o.lineWidth);
      return new Angle(cfg as unknown as AngleConfig);
    }

    case 'connector': {
      cfg['from'] = pointOf(o.from, env, at('from'), items);
      put(cfg, 'to', o.to === undefined ? undefined : pointOf(o.to, env, at('to'), items));
      put(cfg, 'toward', o.toward === undefined ? undefined : dirOf(o.toward, env, at('toward'), items));
      put(cfg, 'length', o.length === undefined ? undefined : numOf(o.length, env, at('length')));
      put(cfg, 'dashed', o.dashed);
      put(cfg, 'shorten', o.shorten);
      put(cfg, 'arrow', o.arrow === undefined ? undefined : boolOf(o.arrow, env, at('arrow')));
      put(cfg, 'labelAt', o.labelAt);
      put(cfg, 'lineWidth', o.lineWidth);
      return new Connector(cfg as unknown as ConnectorConfig);
    }

    case 'trail': {
      cfg['target'] = pointOf(o.target, env, at('target'), items);
      put(cfg, 'relativeTo', o.relativeTo === undefined ? undefined : pointOf(o.relativeTo, env, at('relativeTo'), items));
      cfg['span'] = o.span;
      cfg['step'] = o.step;
      put(cfg, 'bands', o.bands);
      put(cfg, 'lineWidth', o.lineWidth);
      put(cfg, 'dependsOn', o.dependsOn);
      return new Trail(cfg as unknown as TrailConfig);
    }

    case 'ringmarker': {
      put(cfg, 'center', o.center === undefined ? undefined : pointOf(o.center, env, at('center'), items));
      cfg['radius'] = numOf(o.radius, env, at('radius'));
      put(cfg, 'pivot', o.pivot === undefined ? undefined : pointOf(o.pivot, env, at('pivot'), items));
      cfg['toward'] = dirOf(o.toward, env, at('toward'), items);
      put(cfg, 'parallax', o.parallax);
      put(cfg, 'style', o.style);
      put(cfg, 'reach', o.reach);
      put(cfg, 'dotSize', o.dotSize);
      put(cfg, 'lineWidth', o.lineWidth);
      return new RingMarker(cfg as unknown as RingMarkerConfig);
    }
  }
}

function compileZodiac(doc: DiagramDoc, env: Env, items: Map<string, SceneItem>): ZodiacRing | false {
  const z = doc.zodiac;
  if (z === false) return false;
  const where: Where = { id: 'zodiac', field: 'zodiac' };
  const cfg: Record<string, unknown> = { segments: z.segments };
  put(cfg, 'radius', z.radius);
  put(cfg, 'padding', z.padding);
  put(cfg, 'fit', z.fit);
  put(cfg, 'band', z.band);
  put(cfg, 'language', z.language);
  put(cfg, 'font', z.font);
  put(cfg, 'fontHe', z.fontHe);
  put(cfg, 'note', z.note);
  put(cfg, 'color', z.color);
  put(cfg, 'labelColor', z.labelColor);
  put(cfg, 'center', z.center === undefined ? undefined : pointOf(z.center, env, { id: 'zodiac', field: 'center' }, items));

  if (z.constellations !== undefined) {
    if (z.constellations === false) {
      cfg['constellations'] = false;
    } else {
      const c = z.constellations;
      const sub: Record<string, unknown> = { figures: ZODIAC_FIGURES };
      put(sub, 'align', c.align);
      put(sub, 'band', c.band);
      put(sub, 'latitudeSpan', c.latitudeSpan);
      put(sub, 'latitudeGainLimit', c.latitudeGainLimit);
      put(sub, 'nameStarsBrighterThan', c.nameStarsBrighterThan);
      put(sub, 'lonOffset', c.lonOffset === undefined ? undefined : numOf(c.lonOffset, env, { ...where, field: 'constellations.lonOffset' }));
      put(sub, 'color', c.color);
      put(sub, 'starColor', c.starColor);
      put(sub, 'labels', c.labels);
      put(sub, 'show', c.show);
      put(sub, 'note', c.note);
      cfg['constellations'] = sub as unknown as ZodiacConstellations;
    }
  }
  return new ZodiacRing(cfg as unknown as ZodiacConfig);
}

/**
 * The JavaScript name an object's id becomes — in an expression's scope here,
 * and as the `const` in emitted source, which is why it lives in this file and
 * not in `emit.ts`: an expression that says `moonDeferent` in the editor has
 * to say the same thing in the emitted figure, and there can only be one rule.
 *
 * `moon-deferent` becomes `moonDeferent`; an id starting with a digit gets an
 * underscore, since `1` is not a name.
 */
export function varName(id: string): string {
  const camel = id
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
  const safe = camel === '' ? 'item' : camel;
  return /^[0-9]/.test(safe) ? `_${safe}` : safe;
}

/** Everything that went wrong, structural and expression alike — what the
 * editor's problem strip shows after a draw. */
export function allProblems(fig: CompiledFigure): (DocProblem | ExprProblem)[] {
  return [...fig.problems, ...fig.env.allProblems()];
}
