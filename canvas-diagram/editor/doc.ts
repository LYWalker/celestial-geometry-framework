/**
 * The serialisable form of a figure — what the editor edits, what `compile.ts`
 * turns into live Scene/Stage objects, and what `emit.ts` writes back out as
 * ordinary TypeScript.
 *
 * Why a second representation at all, when the scene layer is already
 * declarative? Because `SphereConfig.radius` is a `Scalar`, and a `Scalar` may
 * be a closure. A closure is exactly the right thing for an author writing
 * TypeScript and exactly the wrong thing for a UI: it cannot be shown in a
 * text field, stored in a file, diffed, or handed back after a reload. So
 * every field that the scene layer types as "a number *or* a function of the
 * frame" is typed here as "a number *or* a short source string"
 * (`{ expr: 'f.t * 22' }`), and `compile.ts` is the one place that turns the
 * second into the first.
 *
 * That choice is what makes the round trip honest: a document compiles to the
 * same objects a hand-written figure builds, and emits the same source a
 * hand-written figure would have been. The editor is then a view over the
 * document rather than a separate authoring system with its own runtime, and
 * a figure can leave the editor for the codebase without being rewritten.
 *
 * Three rules hold everywhere in this file:
 *
 *  - Every value that may vary with the frame is a `…Value` union with an
 *    `{ expr }` arm. Nothing is "number only" that the scene layer allows to
 *    move.
 *  - References between objects are by `id` string, never by object identity,
 *    so a document is plain JSON and a reference survives a reload. Cycles
 *    are possible to *write* and are caught here, rather than sixty-four
 *    levels deep inside `resolvePoint` at draw time.
 *  - Optional fields are omitted, never set to `undefined`. The whole file is
 *    read under `exactOptionalPropertyTypes`, and an explicitly-undefined key
 *    would not survive `JSON.stringify` anyway, so the two forms must not be
 *    allowed to mean different things.
 */

import type { Face } from '../labels.js';
import {
  DEFAULT_BACKGROUND as SCENE_BACKGROUND,
  DEFAULT_THEME as SCENE_THEME,
  MAZALOT as SCENE_MAZALOT,
} from '../scene/defaults.js';

/** The document format's own version, bumped when a migration is needed. */
export const DOC_VERSION = 1;

/**
 * A snippet of TypeScript evaluated with the frame in scope as `f` — the
 * serialisable stand-in for every closure the scene layer accepts.
 *
 * Wrapped in an object rather than being a bare string so that a `Scalar`
 * field can hold either arm without ambiguity: `radius: 120` and
 * `radius: { expr: 'f.scaleT * 120' }` are distinguishable by type, where
 * `radius: '120'` would only be distinguishable by parsing.
 */
export interface Expr {
  expr: string;
}

export function isExpr(v: unknown): v is Expr {
  return typeof v === 'object' && v !== null && typeof (v as Expr).expr === 'string';
}

/** A reference to another object in the same document, by its `id`. */
export interface Ref {
  ref: string;
}

export function isRef(v: unknown): v is Ref {
  return typeof v === 'object' && v !== null && typeof (v as Ref).ref === 'string';
}

/** A literal world-space point. */
export interface XY {
  x: number;
  y: number;
}

export function isXY(v: unknown): v is XY {
  return typeof v === 'object' && v !== null && typeof (v as XY).x === 'number' && typeof (v as XY).y === 'number';
}

/** The document form of `Scalar`. */
export type NumValue = number | Expr;
/** The document form of `BoolLike`. */
export type BoolValue = boolean | Expr;
/** The document form of `Meta.gloss` — a fixed line, or one stating a live figure. */
export type TextValue = string | Expr;
/** The document form of `PointLike`: another object, a fixed point, or a computed one. */
export type PointValue = Ref | XY | Expr;
/** The document form of `DirectionLike`: a bearing, "toward that object", or computed. */
export type DirValue = number | Ref | Expr;
/** The document form of `Meta.labelDir` — a direction hint, fixed or live. */
export type VecValue = XY | Expr;

/** The document form of `Face`, which is already plain data. */
export type FaceDoc = Face;

/**
 * One named input the figure's expressions can read besides the clock, and
 * the control the editor gives it.
 *
 * This is the document's answer to the question `Frame` raises: a figure with
 * a mode crossfade needs `f.shellT` to come from somewhere, and in a
 * hand-written figure that somewhere is an `<input type=range>` the author
 * wired up by hand. Declaring the parameter here means the editor can build
 * that control itself, an expression can read `f.shellT` immediately, and
 * `emit.ts` knows which keys to put in the emitted `frame()` call.
 */
export interface ParamDoc {
  /** the key it appears under on the Frame — `shellT` for `f.shellT` */
  key: string;
  /** what the editor's control is labelled */
  label?: string;
  /** `range` draws a slider, `toggle` a checkbox that reads 0 or 1 */
  control?: 'range' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  /** the value the figure opens at, and the one `emit.ts` writes as the default */
  value: number;
  description?: string;
}

/** Fields every object carries — `Meta`, in document form. */
export interface MetaDoc {
  id: string;
  name: string;
  nameHe?: string;
  description?: string;
  color?: string;
  opacity?: NumValue;
  gloss?: TextValue;
  hebrewFirst?: boolean;
  labelDir?: VecValue;
  labelFont?: FaceDoc;
  labelSubFont?: FaceDoc;
  labelRank?: number;
  labelGap?: number;
  showLabel?: boolean;
  excludeFromExtent?: boolean;
  layer?: number;
}

export interface AnchorDoc extends MetaDoc {
  kind: 'anchor';
  at?: PointValue;
  marker?: 'cross' | 'crosshair' | 'dot' | 'none';
  dotSize?: number;
  /** a body drawn here instead of the marker — see `SphereDoc.render` */
  render?: Ref | Expr;
  /** which known body it is, for the editor's menu — see `SphereDoc.body` */
  body?: string;
}

export interface EccentricDoc {
  ratio: NumValue;
  direction: DirValue;
}

export interface PlaneDoc {
  tilt: NumValue;
  nodes: DirValue;
  behindFade?: number;
}

export interface SphereDoc extends MetaDoc {
  kind: 'sphere';
  radius: NumValue;
  center?: PointValue;
  eccentric?: EccentricDoc;
  speed?: number;
  phase?: number;
  angle?: NumValue;
  countFrom?: 'east' | 'carrier';
  clockwise?: boolean;
  /**
   * Which of the known bodies (`bodies.ts`) rides it — `'sun'`, `'moon'` — or
   * `'custom'` for one named and drawn by hand. The editor's own note, so its
   * menu can say what was chosen: the name, colour and icon it brought are
   * ordinary fields, and this one is neither compiled nor emitted.
   */
  body?: string;
  plane?: PlaneDoc;
  measureFrom?: PointValue;
  showRing?: boolean;
  showBody?: boolean;
  markCenter?: BoolValue;
  dotSize?: number;
  labelAt?: DirValue;
  /**
   * How the carried body draws itself, when not Scene's plain dot. Named
   * rather than inlined: a renderer is a canvas routine, not a value, and the
   * useful ones (a lit disc, a glow, a ringed planet) are worth having once in
   * `renderers.ts` under a name both the editor's menu and the emitted source
   * can say. An `{ expr }` here is still allowed for the one-off case, and
   * must evaluate to a `BodyRenderer`.
   */
  render?: Ref | Expr;
}

export interface AngleDoc extends MetaDoc {
  kind: 'angle';
  vertex: PointValue;
  from: DirValue;
  to: DirValue;
  radius: NumValue;
  short?: boolean;
  clockwise?: boolean;
  showValue?: boolean;
  /** how to write the value — an `{ expr }` taking `(degrees)`, for a quantity
   * whose own convention is not `"12.3°"`: a correction the Rambam states in
   * arc-minutes, say */
  format?: Expr;
  lineWidth?: number;
}

export interface ConnectorDoc extends MetaDoc {
  kind: 'connector';
  from: PointValue;
  to?: PointValue;
  toward?: DirValue;
  length?: NumValue;
  dashed?: boolean;
  shorten?: number;
  arrow?: BoolValue;
  labelAt?: number;
  lineWidth?: number;
}

export interface TrailDoc extends MetaDoc {
  kind: 'trail';
  target: PointValue;
  relativeTo?: PointValue;
  span: number;
  step: number;
  bands?: number;
  lineWidth?: number;
  dependsOn?: string[];
}

export interface RingMarkerDoc extends MetaDoc {
  kind: 'ringmarker';
  center?: PointValue;
  radius: NumValue;
  pivot?: PointValue;
  toward: DirValue;
  parallax?: 'none' | 'finite';
  style?: 'solid' | 'open';
  reach?: { in: number; out: number };
  dotSize?: number;
  lineWidth?: number;
}

export type ObjectDoc = AnchorDoc | SphereDoc | AngleDoc | ConnectorDoc | TrailDoc | RingMarkerDoc;
export type ObjectKind = ObjectDoc['kind'];

/** Every kind the editor can add, in the order its menu offers them —
 * roughly the order a figure gets built: the points first, then what turns
 * about them, then what is measured between them. */
export const OBJECT_KINDS: readonly ObjectKind[] = ['anchor', 'sphere', 'connector', 'angle', 'trail', 'ringmarker'];

/**
 * The kinds that have a place, and so may be the target of a `{ ref }`.
 *
 * Not every scene object is one. An Angle is a quantity — a number of degrees
 * between two bearings — and a Connector is a line drawn between two things
 * that do have places; neither implements `Positioned`, so "centre this sphere
 * on that angle" is not a thing that can be meant. The editor's reference
 * pickers offer only these three.
 */
export const POSITIONED_KINDS: readonly ObjectKind[] = ['anchor', 'sphere', 'ringmarker'];

export interface BackgroundDoc {
  mid: string;
  deep: string;
  star: string;
  vignette: string;
}

export interface ZodiacSegmentDoc {
  name: string;
  nameHe?: string;
  description?: string;
}

export interface ConstellationsDoc {
  /** which set of figures — only the built-in twelve are nameable from a
   * document, since a figure's star list is data, not settings */
  figures: 'zodiac';
  align?: 'sign' | 'sky';
  band?: number;
  latitudeSpan?: number;
  latitudeGainLimit?: number;
  nameStarsBrighterThan?: number | false;
  lonOffset?: NumValue;
  color?: string;
  starColor?: string;
  labels?: boolean;
  show?: boolean;
  note?: string;
}

export interface ZodiacDoc {
  radius?: number | 'auto';
  padding?: number;
  fit?: 'frame' | 'grow';
  band?: number;
  segments: ZodiacSegmentDoc[];
  language?: 'en' | 'he';
  font?: FaceDoc;
  fontHe?: FaceDoc;
  constellations?: ConstellationsDoc | false;
  note?: string;
  color?: string;
  labelColor?: string;
  center?: PointValue;
}

/** `SceneTheme`, in document form — already plain data, listed out so the
 * inspector can offer each field rather than a JSON blob. */
export interface ThemeDoc {
  font: FaceDoc;
  activeFont: FaceDoc;
  subFont: FaceDoc;
  noteFont: FaceDoc;
  nameFont?: FaceDoc;
  inferredFont?: FaceDoc;
  ink: string;
  dim: string;
  halo: string;
  ring: string;
  body: string;
  centerMark: string;
  angle: string;
  connector: string;
  trail: string;
}

/** How the figure's clock runs, and what one unit of it means. */
export interface ClockDoc {
  /** units of `f.t` per real second */
  speed: number;
  /** start animating on load */
  running: boolean;
  /** what one unit stands for, shown beside the scrubber — "days", "seconds" */
  unit?: string;
  /** the clock's value when the figure opens, and what `emit.ts` writes */
  start?: number;
  /** how far the editor's scrubber reaches, in the clock's own units */
  scrub?: number;
}

export interface ViewDoc {
  /**
   * What the camera is sized to fit, world px. `'auto'` fits whatever the
   * scene (and its ring) actually reaches, re-measured on resize — the right
   * default, and what most figures want; a number pins it.
   */
  fitRadius: number | 'auto';
  /** the object the camera holds still. Defaults to the first anchor. */
  refId?: string;
  /** the object light comes from, for any body with a `render` that wants a lit side */
  lightId?: string;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * A whole figure: its objects, the stage under them, the controls over them,
 * and enough prose to explain itself.
 */
export interface DiagramDoc {
  version: number;
  /** the figure's name — also the emitted component's name */
  name: string;
  /** the note at the top of the emitted file, and the figure's own caption */
  description?: string;
  clock: ClockDoc;
  view: ViewDoc;
  params: ParamDoc[];
  theme: ThemeDoc;
  background: BackgroundDoc | false;
  zodiac: ZodiacDoc | false;
  objects: ObjectDoc[];
}

/* -------------------------------------------------------------------------
 * Defaults
 *
 * A new figure opens as something rather than nothing: the dark sky, the
 * Hebrew/Latin pair of faces these figures are set in, and an earth at the
 * origin to hang the first sphere off. Every figure in this kit starts that
 * way, so the editor may as well.
 * ---------------------------------------------------------------------- */

// The house style lives in the scene layer, where hand-written figures use it
// too; the document's types are the same shapes, so these are the same values.
export const DEFAULT_THEME: ThemeDoc = SCENE_THEME;
export const DEFAULT_BACKGROUND: BackgroundDoc = SCENE_BACKGROUND;
/** The twelve, English and Hebrew — offered by the editor so a ring appears
 * without an author typing twelve names first. */
export const MAZALOT: readonly ZodiacSegmentDoc[] = SCENE_MAZALOT;

export function emptyDoc(): DiagramDoc {
  return {
    version: DOC_VERSION,
    name: 'Untitled figure',
    clock: { speed: 1, running: true, start: 0, scrub: 400 },
    view: { fitRadius: 'auto', refId: 'earth' },
    params: [],
    theme: structuredClone(DEFAULT_THEME),
    background: structuredClone(DEFAULT_BACKGROUND),
    zodiac: false,
    objects: [
      {
        kind: 'anchor',
        id: 'earth',
        name: 'The earth',
        nameHe: 'הארץ',
        description: 'Everything else in this figure is either centred on it or offset from something that is.',
        marker: 'crosshair',
        color: '#9fb3d9',
      },
    ],
  };
}

/* -------------------------------------------------------------------------
 * Reading a document back
 * ---------------------------------------------------------------------- */

export interface DocProblem {
  /** the object the problem is in, when it belongs to one */
  id?: string;
  /** the field it is in, when it belongs to one */
  field?: string;
  message: string;
}

const VALID_KINDS = new Set<string>(OBJECT_KINDS);

/**
 * Check a document enough to say whether compiling it can be attempted —
 * structure, duplicate ids, dangling references, and the handful of
 * constraints the scene layer's own constructors throw on (a Sphere with both
 * `plane` and `measureFrom`, a Connector with neither `to` nor `toward`).
 *
 * Deliberately not a schema validator. The editor writes these documents and
 * the compiler reports its own failures per object; what this is for is the
 * two cases where a *later* failure would be hard to trace back — a reference
 * to an id that isn't there, and a reference that goes round in a circle —
 * plus giving a hand-written or pasted document one honest look before it is
 * trusted.
 */
export function validateDoc(doc: DiagramDoc): DocProblem[] {
  const problems: DocProblem[] = [];
  if (!Array.isArray(doc.objects)) {
    return [{ message: 'The document has no `objects` array.' }];
  }

  const seen = new Set<string>();
  for (const o of doc.objects) {
    if (!o || typeof o.id !== 'string' || o.id === '') {
      problems.push({ message: 'An object has no id.' });
      continue;
    }
    if (!VALID_KINDS.has(o.kind)) {
      problems.push({ id: o.id, message: `Unknown object kind "${o.kind}".` });
    }
    if (seen.has(o.id)) {
      problems.push({ id: o.id, message: `Two objects share the id "${o.id}" — ids are how they refer to each other.` });
    }
    seen.add(o.id);
  }

  for (const o of doc.objects) {
    for (const [field, value] of refFields(o)) {
      if (field === 'render') continue; // points into the renderer registry, not at an object
      if (!seen.has(value.ref)) {
        problems.push({ id: o.id, field, message: `\`${field}\` points at "${value.ref}", which is not in this figure.` });
      } else if (value.ref === o.id) {
        problems.push({ id: o.id, field, message: `\`${field}\` points at its own object.` });
      }
    }
    if (o.kind === 'sphere' && o.plane !== undefined && o.measureFrom !== undefined) {
      problems.push({
        id: o.id,
        field: 'plane',
        message:
          '`plane` and `measureFrom` cannot be combined — measureFrom solves a ray against a circle, which a tilted plane is not.',
      });
    }
    if (o.kind === 'connector' && o.to === undefined && o.toward === undefined) {
      problems.push({ id: o.id, field: 'to', message: 'A connector needs either `to` or `toward`.' });
    }
  }

  for (const cycle of findCycles(doc)) {
    problems.push({
      id: cycle[0] ?? '',
      message: `These refer to each other in a circle, so no position can be worked out: ${cycle.join(' → ')} → ${cycle[0]}.`,
    });
  }

  if (doc.view.refId !== undefined && doc.view.refId !== '' && !seen.has(doc.view.refId)) {
    problems.push({ field: 'view.refId', message: `The camera is held on "${doc.view.refId}", which is not in this figure.` });
  }
  if (doc.view.lightId !== undefined && doc.view.lightId !== '' && !seen.has(doc.view.lightId)) {
    problems.push({ field: 'view.lightId', message: `The light source "${doc.view.lightId}" is not in this figure.` });
  }

  const paramKeys = new Set<string>();
  for (const p of doc.params) {
    if (p.key === 't') {
      problems.push({ field: `params.${p.key}`, message: "`t` is the clock's own key and cannot be a parameter." });
    }
    if (paramKeys.has(p.key)) {
      problems.push({ field: `params.${p.key}`, message: `Two parameters share the key "${p.key}".` });
    }
    paramKeys.add(p.key);
  }

  return problems;
}

/**
 * Every `{ ref }` an object holds, with the field it sits in — the one place
 * that knows which fields of which kinds can carry a reference, so validation,
 * cycle-finding, renaming and the "what depends on this" check in the editor
 * all agree by construction rather than by four parallel lists.
 *
 * `render` is included even though it points into the renderer registry rather
 * than at another object; callers that care about the difference check the
 * field name, which is cheaper than a second traversal that knows the same
 * shapes.
 */
export function refFields(o: ObjectDoc): [string, Ref][] {
  const out: [string, Ref][] = [];
  const take = (field: string, v: unknown): void => {
    if (isRef(v)) out.push([field, v]);
  };
  take('at', (o as AnchorDoc).at);
  take('center', (o as SphereDoc).center);
  take('measureFrom', (o as SphereDoc).measureFrom);
  take('labelAt', (o as SphereDoc).labelAt);
  take('render', (o as SphereDoc).render);
  if (o.kind === 'sphere' && o.eccentric) take('eccentric.direction', o.eccentric.direction);
  if (o.kind === 'sphere' && o.plane) take('plane.nodes', o.plane.nodes);
  take('vertex', (o as AngleDoc).vertex);
  take('from', (o as AngleDoc | ConnectorDoc).from);
  take('to', (o as AngleDoc | ConnectorDoc).to);
  take('toward', (o as ConnectorDoc | RingMarkerDoc).toward);
  take('target', (o as TrailDoc).target);
  take('relativeTo', (o as TrailDoc).relativeTo);
  take('pivot', (o as RingMarkerDoc).pivot);
  return out;
}

/**
 * Reference cycles among the objects, each reported once as the list of ids
 * that close it.
 *
 * `resolvePoint` already refuses to recurse forever, but it only finds out at
 * draw time, sixty-four levels deep, naming whichever object happened to tip
 * it over. In an editor the mistake is one click away — point this sphere's
 * centre at that one, whose centre is already this one — so it is worth
 * catching where it is made, and naming the actual loop.
 */
function findCycles(doc: DiagramDoc): string[][] {
  const edges = new Map<string, string[]>();
  for (const o of doc.objects) {
    edges.set(
      o.id,
      refFields(o)
        .filter(([field]) => field !== 'render')
        .map(([, r]) => r.ref),
    );
  }

  const cycles: string[][] = [];
  const reported = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];

  const walk = (id: string): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'open') {
      const at = stack.indexOf(id);
      if (at >= 0) {
        const cycle = stack.slice(at);
        // one report per loop, however many of its members we enter from
        const key = [...cycle].sort().join('|');
        if (!reported.has(key)) {
          reported.add(key);
          cycles.push(cycle);
        }
      }
      return;
    }
    state.set(id, 'open');
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (edges.has(next)) walk(next);
    }
    stack.pop();
    state.set(id, 'done');
  };

  for (const o of doc.objects) walk(o.id);
  return cycles;
}

/**
 * An id made from a name — `the moon's epicycle` → `moons-epicycle` — unique
 * among `taken`, or null for a name that makes none. A leading "the" is
 * dropped: every name in these figures has one, and `const theMoon` says
 * nothing `const moon` does not.
 */
export function idFromName(name: string, taken: ReadonlySet<string>): string | null {
  const base = name
    .toLowerCase()
    .replace(/['’]s\b/g, 's')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (base === '' || /^\d/.test(base)) return null;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Read a document from JSON text, failing with a readable message rather
 * than a `SyntaxError` from somewhere inside the editor. */
export function parseDoc(text: string): { doc: DiagramDoc; problems: DocProblem[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `That isn't valid JSON: ${(e as Error).message}` };
  }
  if (typeof raw !== 'object' || raw === null) return { error: 'That JSON is not an object.' };
  const doc = raw as DiagramDoc;
  if (typeof doc.version !== 'number') return { error: 'That JSON has no `version`, so it is not a figure document.' };
  if (doc.version > DOC_VERSION) {
    return {
      error: `That figure was written by a newer editor (version ${doc.version}); this one reads up to ${DOC_VERSION}.`,
    };
  }
  // Fill in what a hand-written or older document may legitimately omit,
  // rather than letting a missing array crash the first render.
  doc.objects ??= [];
  doc.params ??= [];
  doc.theme ??= structuredClone(DEFAULT_THEME);
  doc.clock ??= { speed: 1, running: true };
  doc.view ??= { fitRadius: 'auto' };
  if (doc.background === undefined) doc.background = structuredClone(DEFAULT_BACKGROUND);
  if (doc.zodiac === undefined) doc.zodiac = false;
  return { doc, problems: validateDoc(doc) };
}

/** Write a document out as the JSON the editor's Save produces — indented, and
 * in whatever key order the object literals were built with, so two saves of
 * the same figure diff as the edit that was actually made. */
export function serializeDoc(doc: DiagramDoc): string {
  return JSON.stringify(doc, null, 2);
}
