/**
 * A document, written back out as the TypeScript someone would have written by
 * hand.
 *
 * This is what stops the editor from being a parallel universe. A figure built
 * by dragging things around leaves as source: the same imports, the same
 * `new Sphere({ … })` literals, the same `(f) => …` closures, in the same
 * order and the same shape as `components/CanvasDiagramDemo.astro`. It can be
 * committed, reviewed, hand-edited afterwards, and it no longer needs the
 * editor — or the document — to run.
 *
 * Two rules keep the output honest:
 *
 *  - **Emit what the document says, not what it means.** An omitted field is
 *    omitted in the source too, so the scene layer's own defaults (a Sphere's
 *    `showBody` derived from whether it turns, an Anchor's origin) stay
 *    visible as defaults rather than being frozen into literals that would
 *    stop tracking them.
 *  - **Emit only the imports used.** A figure with no trails should not import
 *    `Trail`; the file is read by people, and an import list that is a
 *    catalogue of everything the kit has rather than an inventory of what this
 *    figure is made of is noise.
 *
 * `varName` is shared with `compile.ts` rather than reimplemented, because an
 * expression that says `moonDeferent` in the editor has to say the same thing
 * in the emitted file, and there can only be one rule for what an id is called.
 */

import { isExpr, isRef, isXY, refFields, type DiagramDoc, type ObjectDoc } from './doc.js';
import { varName } from './compile.js';
import { formatLongitude } from './units.js';
import { DEFAULT_BACKGROUND, DEFAULT_THEME } from '../scene/defaults.js';

export interface EmitOptions {
  /**
   * What to write.
   *
   * - `'scene'` — the declarations alone: the theme, the objects, the Scene.
   *   For pasting into a figure that already has its own chrome.
   * - `'component'` — a whole `.astro` component: markup, styles, and the
   *   wiring (camera, resize, animation loop, hover) around the same
   *   declarations. What a new figure wants.
   */
  target?: 'scene' | 'component';
  /** where the kit is imported from. Defaults to the package name; a figure
   * living inside this repo wants a relative path instead. */
  from?: string;
  /** where a named body renderer is imported from, when the figure uses one.
   * Defaults to the kit's own `editor/renderers`. */
  rendererImport?: string;
}

const KIT = 'celestial-geometry-framework';

export interface EmittedFile {
  filename: string;
  code: string;
}

export function emitDocument(doc: DiagramDoc, opts: EmitOptions = {}): EmittedFile {
  const target = opts.target ?? 'component';
  const base = pascal(doc.name) || 'Figure';
  return target === 'scene'
    ? { filename: `${base}.ts`, code: emitScene(doc, opts) }
    : { filename: `${base}.astro`, code: emitComponent(doc, opts) };
}

/* -------------------------------------------------------------------------
 * Values
 *
 * One printer per resolver in compile.ts, in the same order, so the two can be
 * read side by side and seen to agree.
 * ---------------------------------------------------------------------- */

/**
 * The name of the wrapper a figure with parameters reads its frame through.
 * See `emitFrameType` for why it exists; it is a named constant because both
 * the declaration and every use of it have to agree.
 */
const FRAME_WRAPPER = 'on';

/**
 * Whether the figure currently being emitted declares parameters, and so needs
 * its expressions wrapped.
 *
 * Module state, set for the duration of one emit by `withFrameWrapper`. The
 * alternative is threading a flag through all six value printers and every
 * caller of them, to say one thing that is true of the whole file — this is
 * the smaller cost, and it cannot leak, because both entry points go through
 * the wrapper and it restores in a `finally`.
 */
let wrapFrameExprs = false;
/** What one unit of the clock is, for the notes beside a rate — set with it. */
let clockUnit = 'day';

function withFrameWrapper<T>(doc: DiagramDoc, emit: () => T): T {
  const was = wrapFrameExprs;
  const wasUnit = clockUnit;
  wrapFrameExprs = doc.params.length > 0;
  clockUnit = (doc.clock.unit ?? 'day').replace(/s$/, '') || 'day';
  try {
    return emit();
  } finally {
    wrapFrameExprs = was;
    clockUnit = wasUnit;
  }
}

/**
 * An expression becomes the closure the scene layer wanted all along.
 *
 * An expression that never mentions the frame gets a closure that never names
 * it — `() => polar(86.8, 5.25)` rather than `(f) => …`. A zero-argument
 * function is assignable wherever a one-argument one is, and an unused `f` is
 * an error under `noUnusedParameters`, which is exactly the sort of thing that
 * makes emitted code feel machine-made.
 */
function expr(src: string): string {
  const head = /\bf\b/.test(src) ? '(f)' : '()';
  return wrapFrameExprs ? `${FRAME_WRAPPER}(${head} => ${src})` : `${head} => ${src}`;
}

function num(v: unknown): string {
  return isExpr(v) ? expr(v.expr) : fmtNumber(v as number);
}

function bool(v: unknown): string {
  return isExpr(v) ? expr(v.expr) : String(v);
}

function text(v: unknown): string {
  return isExpr(v) ? expr(v.expr) : str(v as string);
}

function point(v: unknown): string {
  if (isRef(v)) return varName(v.ref);
  if (isExpr(v)) return expr(v.expr);
  if (isXY(v)) return `{ x: ${fmtNumber(v.x)}, y: ${fmtNumber(v.y)} }`;
  return '{ x: 0, y: 0 }';
}

function dir(v: unknown): string {
  if (typeof v === 'number') return fmtNumber(v);
  if (isRef(v)) return varName(v.ref);
  if (isExpr(v)) return expr(v.expr);
  return '0';
}

function vec(v: unknown): string {
  if (isXY(v)) return `{ x: ${fmtNumber(v.x)}, y: ${fmtNumber(v.y)} }`;
  if (isExpr(v)) return expr(v.expr);
  return '{ x: 1, y: 0 }';
}

/**
 * A value with no union behind it — a face, a reach, a list of segment names —
 * printed as a TypeScript literal rather than as JSON.
 *
 * `JSON.stringify` would be shorter and would emit `{"css":"…"}`: double
 * quotes, quoted keys, no spaces. None of that is how this codebase writes an
 * object literal, and the whole claim of this file is that what it produces is
 * what someone would have written. So: single quotes, bare keys where they are
 * valid identifiers, and a list that has grown too long for one line broken
 * one entry per line rather than run off the right-hand edge.
 */
function json(v: unknown, indent = ''): string {
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number') return fmtNumber(v);
  if (v === null || typeof v === 'boolean') return String(v);

  if (Array.isArray(v)) {
    const parts = v.map((item) => json(item, `${indent}  `));
    const oneLine = `[${parts.join(', ')}]`;
    if (oneLine.length + indent.length <= 96) return oneLine;
    return `[\n${parts.map((p) => `${indent}  ${p},`).join('\n')}\n${indent}]`;
  }

  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : str(key)}: ${json(value, `${indent}  `)}`);
    if (parts.length === 0) return '{}';
    const oneLine = `{ ${parts.join(', ')} }`;
    if (oneLine.length + indent.length <= 96) return oneLine;
    return `{\n${parts.map((p) => `${indent}  ${p},`).join('\n')}\n${indent}}`;
  }

  return 'undefined';
}

function str(s: string): string {
  // Single quotes, this codebase's own convention, with the two characters
  // that would end the literal escaped and nothing else — a Hebrew name must
  // come out as itself, not as a run of \u05xx.
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/** Numbers as an author would have typed them: no exponent for ordinary
 * magnitudes, and no `0.30000000000000004` from an editor's arithmetic — but
 * no rounding that loses anything either: a daily motion cut to six places
 * drifts visibly over the thousands of days these figures run. */
function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

/** Separates a printed value from the note that follows its comma. */
const NOTE = '\u0001';

/**
 * An angle or a rate that was given in degrees, minutes and seconds, written
 * back that way — `13 + 10 / 60 + 35 / 3600` rather than `13.1763888889` —
 * so the source reads as the text it came from, and is exact. Anything that
 * is not a whole number of seconds (or tenths of one) is left as a decimal.
 */
function sexagesimal(kind: 'rate' | 'bearing' | 'angle'): (v: unknown) => string {
  return (v) => {
    if (typeof v !== 'number') return kind === 'rate' ? num(v) : dir(v);
    const a = Math.abs(v);
    const tenths = Math.round(a * 36000);
    if (Number.isInteger(v) || Math.abs(a * 36000 - tenths) > 1e-6) return fmtNumber(v);
    const d = Math.floor(tenths / 36000);
    const m = Math.floor((tenths - d * 36000) / 600);
    const sec = (tenths - d * 36000 - m * 600) / 10;
    const parts = [String(d)];
    if (m) parts.push(`${m} / 60`);
    if (sec) parts.push(`${sec} / 3600`);
    const expr = `${v < 0 ? '-(' : ''}${parts.join(' + ')}${v < 0 ? ')' : ''}`;
    const said = `${d}°${m ? `${m}′` : ''}${sec ? `${sec}″` : ''}`;
    const note =
      kind === 'rate'
        ? `${said} a ${clockUnit}`
        : kind === 'bearing'
          ? formatLongitude(v)
          : said;
    return `${expr}${NOTE}${note}`;
  };
}

function pascal(s: string): string {
  return s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^[a-z]/, (c) => c.toUpperCase());
}

/* -------------------------------------------------------------------------
 * Object literals
 * ---------------------------------------------------------------------- */

type Entry = [string, string];

/** Build the `{ … }` of a config, dropping every field the document omitted
 * and laying it out as this codebase lays out its own: one field per line, the
 * description on its own, trailing commas throughout. */
function literal(entries: Entry[], indent = '    '): string {
  const inner = entries
    .map(([k, v]) => {
      // a value may carry a trailing note (see `sexagesimal`), which belongs
      // after the comma, not inside the expression
      const [value, note] = v.split(NOTE);
      return `${indent}  ${k}: ${value},${note !== undefined ? ` // ${note}` : ''}`;
    })
    .join('\n');
  return `{\n${inner}\n${indent}}`;
}

/** `push` that skips absent fields — the emitter's half of compile.ts's `put`. */
function take(out: Entry[], key: string, value: unknown, print: (v: unknown) => string): void {
  if (value !== undefined) out.push([key, print(value)]);
}

function metaEntries(o: ObjectDoc): Entry[] {
  const e: Entry[] = [['id', str(o.id)], ['name', str(o.name)]];
  take(e, 'nameHe', o.nameHe, (v) => str(v as string));
  take(e, 'description', o.description, (v) => str(v as string));
  take(e, 'color', o.color, (v) => str(v as string));
  take(e, 'opacity', o.opacity, num);
  take(e, 'gloss', o.gloss, text);
  take(e, 'hebrewFirst', o.hebrewFirst, String);
  take(e, 'labelDir', o.labelDir, vec);
  take(e, 'labelFont', o.labelFont, json);
  take(e, 'labelSubFont', o.labelSubFont, json);
  take(e, 'labelRank', o.labelRank, num);
  take(e, 'labelGap', o.labelGap, num);
  take(e, 'showLabel', o.showLabel, String);
  take(e, 'excludeFromExtent', o.excludeFromExtent, String);
  take(e, 'layer', o.layer, num);
  return e;
}

const CLASS_OF: Record<ObjectDoc['kind'], string> = {
  anchor: 'Anchor',
  sphere: 'Sphere',
  angle: 'Angle',
  connector: 'Connector',
  trail: 'Trail',
  ringmarker: 'RingMarker',
};

function emitObject(o: ObjectDoc): string {
  const e = metaEntries(o);

  switch (o.kind) {
    case 'anchor':
      take(e, 'at', o.at, point);
      take(e, 'marker', o.marker, (v) => str(v as string));
      take(e, 'dotSize', o.dotSize, num);
      take(e, 'render', o.render, (v) => (isRef(v) ? `renderers.${v.ref}` : (v as { expr: string }).expr));
      break;

    case 'sphere':
      e.push(['radius', num(o.radius)]);
      take(e, 'center', o.center, point);
      if (o.eccentric) {
        e.push(['eccentric', `{ ratio: ${num(o.eccentric.ratio)}, direction: ${sexagesimal('bearing')(o.eccentric.direction).split(NOTE)[0]} }`]);
      }
      take(e, 'speed', o.speed, sexagesimal('rate'));
      take(e, 'phase', o.phase, sexagesimal(o.countFrom === 'carrier' ? 'angle' : 'bearing'));
      take(e, 'angle', o.angle, typeof o.angle === 'number' ? sexagesimal(o.countFrom === 'carrier' ? 'angle' : 'bearing') : num);
      take(e, 'countFrom', o.countFrom, (v) => str(v as string));
      take(e, 'clockwise', o.clockwise, String);
      if (o.plane) {
        const p: Entry[] = [['tilt', num(o.plane.tilt)], ['nodes', dir(o.plane.nodes)]];
        take(p, 'behindFade', o.plane.behindFade, num);
        e.push(['plane', `{ ${p.map(([k, v]) => `${k}: ${v}`).join(', ')} }`]);
      }
      take(e, 'measureFrom', o.measureFrom, point);
      take(e, 'showRing', o.showRing, String);
      take(e, 'showBody', o.showBody, String);
      take(e, 'markCenter', o.markCenter, bool);
      take(e, 'dotSize', o.dotSize, num);
      take(e, 'labelAt', o.labelAt, dir);
      // A named renderer emits as the name itself, imported at the top; a
      // one-off emits as its own source, which is already a BodyRenderer.
      // A named renderer is reached through the namespace rather than imported
      // bare: the registry has a renderer called `sun`, and so does nearly
      // every one of these figures have an object called `sun`. One would
      // shadow the other, and the error it produced would name neither.
      take(e, 'render', o.render, (v) => (isRef(v) ? `renderers.${v.ref}` : (v as { expr: string }).expr));
      break;

    case 'angle':
      e.push(['vertex', point(o.vertex)], ['from', dir(o.from)], ['to', dir(o.to)], ['radius', num(o.radius)]);
      take(e, 'short', o.short, String);
      take(e, 'clockwise', o.clockwise, String);
      take(e, 'showValue', o.showValue, String);
      take(e, 'format', o.format, (v) => (v as { expr: string }).expr);
      take(e, 'lineWidth', o.lineWidth, num);
      break;

    case 'connector':
      e.push(['from', point(o.from)]);
      take(e, 'to', o.to, point);
      take(e, 'toward', o.toward, sexagesimal('bearing'));
      take(e, 'length', o.length, num);
      take(e, 'dashed', o.dashed, String);
      take(e, 'shorten', o.shorten, num);
      take(e, 'arrow', o.arrow, bool);
      take(e, 'labelAt', o.labelAt, num);
      take(e, 'lineWidth', o.lineWidth, num);
      break;

    case 'trail':
      e.push(['target', point(o.target)]);
      take(e, 'relativeTo', o.relativeTo, point);
      e.push(['span', num(o.span)], ['step', num(o.step)]);
      take(e, 'bands', o.bands, num);
      take(e, 'lineWidth', o.lineWidth, num);
      take(e, 'dependsOn', o.dependsOn, json);
      break;

    case 'ringmarker':
      take(e, 'center', o.center, point);
      e.push(['radius', num(o.radius)]);
      take(e, 'pivot', o.pivot, point);
      e.push(['toward', sexagesimal('bearing')(o.toward)]);
      take(e, 'parallax', o.parallax, (v) => str(v as string));
      take(e, 'style', o.style, (v) => str(v as string));
      take(e, 'reach', o.reach, json);
      take(e, 'dotSize', o.dotSize, num);
      take(e, 'lineWidth', o.lineWidth, num);
      break;
  }

  return `  const ${varName(o.id)} = new ${CLASS_OF[o.kind]}(${literal(e, '  ')});`;
}

/* -------------------------------------------------------------------------
 * The pieces around the objects
 * ---------------------------------------------------------------------- */

/** The theme fields that differ from the house style — all a figure has to
 * state, since the rest is `DEFAULT_THEME`. */
function themeOverrides(doc: DiagramDoc): Entry[] {
  const e: Entry[] = [];
  for (const [k, v] of Object.entries(doc.theme)) {
    if (v === undefined) continue;
    const house = (DEFAULT_THEME as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(v) === JSON.stringify(house)) continue;
    e.push([k, typeof v === 'string' ? str(v) : json(v)]);
  }
  return e;
}

function emitTheme(doc: DiagramDoc): string {
  const overrides = themeOverrides(doc);
  if (overrides.length === 0) return 'const THEME: SceneTheme = DEFAULT_THEME;';
  const inner = overrides.map(([k, v]) => `  ${k}: ${v},`).join('\n');
  return `const THEME: SceneTheme = {\n  ...DEFAULT_THEME,\n${inner}\n};`;
}

/** Whether the background is anything but the house sky. */
function backgroundDiffers(doc: DiagramDoc): boolean {
  return doc.background === false || JSON.stringify(doc.background) !== JSON.stringify(DEFAULT_BACKGROUND);
}

function emitZodiac(doc: DiagramDoc, indent = '      '): string {
  if (doc.zodiac === false) return 'false';
  const z = doc.zodiac;
  const e: Entry[] = [];
  take(e, 'radius', z.radius, (v) => (v === 'auto' ? "'auto'" : fmtNumber(v as number)));
  take(e, 'padding', z.padding, num);
  take(e, 'fit', z.fit, (v) => str(v as string));
  take(e, 'band', z.band, num);
  e.push(['segments', json(z.segments, `${indent}  `)]);
  take(e, 'language', z.language, (v) => str(v as string));
  take(e, 'font', z.font, json);
  take(e, 'fontHe', z.fontHe, json);
  take(e, 'note', z.note, (v) => str(v as string));
  take(e, 'color', z.color, (v) => str(v as string));
  take(e, 'labelColor', z.labelColor, (v) => str(v as string));
  take(e, 'center', z.center, point);
  if (z.constellations !== undefined) {
    if (z.constellations === false) {
      e.push(['constellations', 'false']);
    } else {
      const c = z.constellations;
      const sub: Entry[] = [['figures', 'ZODIAC_FIGURES']];
      take(sub, 'align', c.align, (v) => str(v as string));
      take(sub, 'band', c.band, num);
      take(sub, 'latitudeSpan', c.latitudeSpan, num);
      take(sub, 'latitudeGainLimit', c.latitudeGainLimit, num);
      take(sub, 'nameStarsBrighterThan', c.nameStarsBrighterThan, (v) => (v === false ? 'false' : fmtNumber(v as number)));
      take(sub, 'lonOffset', c.lonOffset, num);
      take(sub, 'color', c.color, (v) => str(v as string));
      take(sub, 'starColor', c.starColor, (v) => str(v as string));
      take(sub, 'labels', c.labels, String);
      take(sub, 'show', c.show, String);
      take(sub, 'note', c.note, (v) => str(v as string));
      e.push(['constellations', literal(sub, `${indent}  `)]);
    }
  }
  return literal(e, indent);
}

/**
 * Which of the kit's names this figure actually uses.
 *
 * Computed rather than listed, because the emitted file is read by people: an
 * import list that is a catalogue of everything the kit has, rather than an
 * inventory of what this figure is made of, is noise — and under a strict
 * `noUnusedLocals` it is an error.
 */
function importsFor(doc: DiagramDoc, target: 'scene' | 'component'): string[] {
  const used = new Set<string>(['Scene']);
  for (const o of doc.objects) used.add(CLASS_OF[o.kind]);
  if (doc.params.length > 0) used.add('type Frame');
  // whatever the figure's own expressions reach for
  for (const helper of helpersUsed(doc, KIT_HELPERS)) used.add(helper);
  // a figure whose expressions ask the ring how big it is needs the ring, in
  // both targets — the declarations cannot be emitted without it
  if (doc.zodiac !== false && ringHelpersUsed(doc).length > 0) {
    used.add('ZodiacRing');
    used.add('type Frame');
    if (doc.zodiac.constellations) used.add('ZODIAC_FIGURES');
  }

  if (target === 'scene') {
    used.add('DEFAULT_THEME');
    used.add('type SceneTheme');
  } else {
    // the chrome round the figure is one call now, not a dozen imports
    used.add('mountAll');
    used.add('mountFigure');
    if (doc.zodiac !== false) {
      used.add('ZodiacRing');
      if (doc.zodiac.constellations) used.add('ZODIAC_FIGURES');
    }
  }
  return [...used].sort((a, b) => a.replace('type ', '').localeCompare(b.replace('type ', '')));
}

/** Every expression source in a document, for the scans below. */
function expressionSources(doc: DiagramDoc): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec['expr'] === 'string') out.push(rec['expr']);
    for (const value of Object.values(rec)) walk(value);
  };
  walk(doc.objects);
  if (doc.zodiac !== false) walk(doc.zodiac);
  return out.join('\n');
}

/** The kit's own geometry an expression may name — all exported from the
 * kit's barrel, so an expression using one emits as an ordinary import. */
const KIT_HELPERS = ['DEG', 'polar', 'lonOf', 'norm360', 'clamp', 'unit', 'sub', 'add', 'dot', 'distanceBetween', 'bearingFrom'];
/** The editor's own three, exported from `editor/expr.ts` for this reason. */
const EDITOR_HELPERS = ['lerp', 'ease', 'wrap180'];

function helpersUsed(doc: DiagramDoc, from: readonly string[]): string[] {
  const text = expressionSources(doc);
  // Doubled, because this is a template literal: a single `\b` in one is a
  // backspace, not a word boundary, and the scan would then match nothing.
  return from.filter((name) => new RegExp(String.raw`\b` + name + String.raw`\b`).test(text));
}

/** The named renderers this figure uses, so they can be imported. */
function renderersUsed(doc: DiagramDoc): string[] {
  const names = new Set<string>();
  for (const o of doc.objects) {
    if ((o.kind === 'sphere' || o.kind === 'anchor') && o.render !== undefined && isRef(o.render)) names.add(o.render.ref);
  }
  return [...names].sort();
}

function header(doc: DiagramDoc): string {
  const lines = [`/**`, ` * ${doc.name}`];
  if (doc.description) {
    lines.push(' *');
    for (const line of wrap(doc.description, 72)) lines.push(` * ${line}`);
  }
  lines.push(' */');
  return lines.join('\n');
}

/** Break prose at 72 characters on word boundaries, the width this codebase's
 * own comments are set to. */
function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line === '') line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/* -------------------------------------------------------------------------
 * The two targets
 * ---------------------------------------------------------------------- */

/**
 * The order the `const`s are written in.
 *
 * Not document order: `const moon = new Sphere({ center: moonDeferent })` has
 * to come after `moonDeferent`, and a document is free to declare them the
 * other way round — references in a document are late, and in TypeScript they
 * are not. So the declarations come out in dependency order (a depth-first
 * walk, so a thing is written after everything it names), while the `.add()`
 * calls keep document order, which is what Scene uses to break ties between
 * objects on the same layer.
 *
 * A cycle cannot be ordered at all, and `validateDoc` refuses one long before
 * this — but a hand-written document could still reach here with one, so the
 * walk keeps its own guard and falls back to document order rather than
 * looping forever.
 */
function declarationOrder(doc: DiagramDoc): ObjectDoc[] {
  const byId = new Map(doc.objects.map((o) => [o.id, o]));
  const out: ObjectDoc[] = [];
  const done = new Set<string>();
  const open = new Set<string>();

  const walk = (o: ObjectDoc): void => {
    if (done.has(o.id) || open.has(o.id)) return;
    open.add(o.id);
    for (const [field, ref] of refFields(o)) {
      if (field === 'render') continue; // names a renderer, not an object
      const target = byId.get(ref.ref);
      if (target) walk(target);
    }
    open.delete(o.id);
    done.add(o.id);
    out.push(o);
  };

  for (const o of doc.objects) walk(o);
  return out;
}

/**
 * This figure's own Frame type, and the wrapper every expression is written
 * through — emitted only for a figure that declares parameters.
 *
 * `Frame` carries the clock as a named `number` and everything else through an
 * index signature, so under `noUncheckedIndexedAccess` a perfectly correct
 * `f.shells` reads as `number | undefined` and the arithmetic around it will
 * not compile. The kit's hand-written figures answer this by declaring their
 * own frame interface and casting at each use (`(f as OrreryFrame).shellT`),
 * which works and is noisy.
 *
 * Emitting that cast once, as a wrapper, does the same job and leaves the
 * expression exactly as it was typed in the editor — `f.shells * 0.9`, not
 * `(f as OrreryFrame).shells * 0.9`. That matters more than it looks: the text
 * in the document and the text in the emitted file being the same string is
 * what lets someone read one against the other, and what lets an expression be
 * pasted back into the editor out of the source.
 */
function emitFrameType(doc: DiagramDoc, indent: string): string {
  if (doc.params.length === 0) return '';
  const name = frameTypeName(doc);
  const fields = doc.params
    .map((p) => `${indent}  /** ${p.description ?? p.label ?? p.key} */\n${indent}  ${p.key}: number;`)
    .join('\n');
  return (
    `${indent}/** This figure's own frame: the clock, plus the amounts its controls set. */\n` +
    `${indent}interface ${name} extends Frame {\n${fields}\n${indent}}\n\n` +
    `${indent}/** Every Scalar below reads its frame through this — see ${name}. */\n` +
    // `<T,>`, not `<T>`: Astro's compiler reads a bare `<T>(` in a component
    // script as the start of a tag and refuses the file. The comma is the
    // usual TSX spelling of the same generic, and means nothing else.
    `${indent}const ${FRAME_WRAPPER} = <T,>(fn: (f: ${name}) => T) => (f: Frame): T => fn(f as ${name});\n`
  );
}

function frameTypeName(doc: DiagramDoc): string {
  return `${pascal(doc.name) || 'Figure'}Frame`;
}

/** Which of the ring helpers a figure's expressions actually call, so an
 * unused one is not emitted only to be flagged as dead. */
function ringHelpersUsed(doc: DiagramDoc): string[] {
  const text = JSON.stringify(doc.objects);
  return ['ringRadius', 'ringOuter', 'ringEdge'].filter((name) => text.includes(`${name}(`));
}

/**
 * The ring, and the helpers that ask it how big it is — at module scope,
 * before the declarations.
 *
 * It has to be there rather than inside the component's `init`, because the
 * objects themselves reach for it: a reading's radius is `ringRadius(f)` and a
 * sightline's length is `ringOuter(f)`. Emitting it beside the Stage would put
 * it after everything that needs it.
 */
function emitRing(doc: DiagramDoc, indent: string): string {
  if (doc.zodiac === false) return '';
  const helpers = ringHelpersUsed(doc)
    .map((name) => {
      const field = name === 'ringRadius' ? 'radius' : name === 'ringOuter' ? 'outer' : 'edge';
      return `${indent}const ${name} = (f: Frame) => ring.geometry(f)?.${field} ?? 0;\n`;
    })
    .join('');
  return (
    `${indent}// The ring as an object rather than a config, so anything that has to\n` +
    `${indent}// reach it — a reading's radius, a sightline's length — asks the same\n` +
    `${indent}// ring the Stage draws, instead of restating where it is.\n` +
    `${indent}const ring = new ZodiacRing(${emitZodiac(doc, indent)});\n` +
    helpers
  );
}

/** The import of the editor's own helpers, when a figure's expressions use any. */
function emitHelperImport(doc: DiagramDoc, rendererFrom: string, indent: string): string {
  const used = helpersUsed(doc, EDITOR_HELPERS);
  return used.length > 0 ? `${indent}import { ${used.join(', ')} } from ${str(rendererFrom)};\n` : '';
}

/** The declarations alone: theme, objects, Scene. */
export function emitScene(doc: DiagramDoc, opts: EmitOptions = {}): string {
  const from = opts.from ?? KIT;
  const rendererFrom = opts.rendererImport ?? `${KIT}/editor`;

  return withFrameWrapper(doc, () => {
    const parts: string[] = [header(doc), ''];
    parts.push(`import {\n${importsFor(doc, 'scene').map((n) => `  ${n},`).join('\n')}\n} from ${str(from)};`);
    if (renderersUsed(doc).length > 0) {
      parts.push(`import * as renderers from ${str(rendererFrom)};`);
    }
    const helperImport = emitHelperImport(doc, rendererFrom, '');
    if (helperImport) parts.push(helperImport.trimEnd());
    parts.push('', `export ${emitTheme(doc)}`, '');
    const frameType = emitFrameType(doc, '');
    if (frameType) parts.push(frameType);
    // only when something actually asks it for a radius: the scene target has
    // no Stage to draw it with, so an unused ring would just be dead code
    const ring = ringHelpersUsed(doc).length > 0 ? emitRing(doc, '') : '';
    if (ring) parts.push(ring);

    parts.push('export function buildScene() {');
    for (const o of declarationOrder(doc)) parts.push(emitObject(o), '');
    const adds = doc.objects.map((o) => `    .add(${varName(o.id)})`).join('\n');
    parts.push(`  const scene = new Scene()\n${adds};`, '');
    parts.push(`  return { scene, ${doc.objects.map((o) => varName(o.id)).join(', ')} };`);
    parts.push('}');
    return parts.join('\n') + '\n';
  });
}

/**
 * A whole component: the declarations, and one `mountFigure` call for
 * everything around them — the canvas, the camera, the clock, hover, the
 * controls and the screen-reader text. What comes out is the figure and
 * nothing else; the plumbing lives in the kit, once.
 */
function emitComponent(doc: DiagramDoc, opts: EmitOptions): string {
  const from = opts.from ?? KIT;
  const rendererFrom = opts.rendererImport ?? `${KIT}/editor`;
  const slug = doc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figure';
  const refId = doc.view.refId ?? doc.objects.find((o) => o.kind === 'anchor')?.id;
  const refVar = refId !== undefined && doc.objects.some((o) => o.id === refId) ? varName(refId) : '';
  const lightVar = doc.view.lightId ? varName(doc.view.lightId) : '';

  return withFrameWrapper(doc, () => {
    const objectLines = declarationOrder(doc).map(emitObject).join('\n\n');
    const adds = doc.objects.map((o) => `      .add(${varName(o.id)})`).join('\n');

    // Only the objects the mount names. Destructuring all of them "just in
    // case" is how an emitted file arrives with nine unused locals.
    const wanted = [...new Set([refVar, lightVar].filter((v) => v !== ''))];
    const destructure = wanted.length > 0 ? `, ${wanted.join(', ')}` : '';

    // Each option only when it differs from what mountFigure does anyway, so
    // the call reads as a list of what is particular about this figure.
    const I = '      ';
    const mount: Entry[] = [['scene', '']];
    if (refVar) mount.push(['ref', refVar]);
    if (lightVar) mount.push(['light', lightVar]);
    const theme = themeOverrides(doc);
    if (theme.length > 0) mount.push(['theme', literal(theme, I)]);
    if (backgroundDiffers(doc)) {
      mount.push([
        'background',
        doc.background === false ? 'false' : literal(Object.entries(doc.background).map(([k, v]) => [k, str(v)]), I),
      ]);
    }
    if (doc.zodiac !== false) mount.push(['zodiac', 'ring']);
    const clock: Entry[] = [];
    if (doc.clock.speed !== 1) clock.push(['speed', fmtNumber(doc.clock.speed)]);
    if ((doc.clock.start ?? 0) !== 0) clock.push(['start', fmtNumber(doc.clock.start ?? 0)]);
    if (!doc.clock.running) clock.push(['running', 'false']);
    if (clock.length > 0) mount.push(['clock', `{ ${clock.map(([k, v]) => `${k}: ${v}`).join(', ')} }`]);
    if (doc.params.length > 0) {
      const params = doc.params.map((p) => {
        const { description: _description, ...control } = p;
        return control;
      });
      mount.push(['params', json(params, I)]);
    }
    if (doc.view.fitRadius !== 'auto') mount.push(['fit', fmtNumber(doc.view.fitRadius)]);
    if (doc.view.minZoom !== undefined || doc.view.maxZoom !== undefined) {
      const z: Entry[] = [];
      if (doc.view.minZoom !== undefined) z.push(['min', fmtNumber(doc.view.minZoom)]);
      if (doc.view.maxZoom !== undefined) z.push(['max', fmtNumber(doc.view.maxZoom)]);
      mount.push(['zoom', `{ ${z.map(([k, v]) => `${k}: ${v}`).join(', ')} }`]);
    }
    mount.push(['label', str(doc.name)]);
    const mountLiteral = mount.map(([k, v]) => (v === '' ? `${I}${k},` : `${I}${k}: ${v},`)).join('\n');

    const frameType = emitFrameType(doc, '  ');
    const ringModule = emitRing(doc, '  ');

    return `---
${header(doc)}
---

<figure class="${slug}" data-${slug}>
  <figcaption>${escapeHtml(doc.description ?? doc.name)}</figcaption>
</figure>

<style>
  .${slug} figcaption { margin-top: 0.9rem; font-size: 0.84rem; line-height: 1.6; color: #96a0bd; }
</style>

<script>
  import {
${importsFor(doc, 'component').map((n) => `    ${n},`).join('\n')}
  } from ${str(from)};
${renderersUsed(doc).length > 0 ? `  import * as renderers from ${str(rendererFrom)};\n` : ''}${emitHelperImport(doc, rendererFrom, '  ')}${frameType ? `\n${frameType}` : ''}${ringModule ? `\n${ringModule}` : ''}
  function buildScene() {
${objectLines.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}

    const scene = new Scene()
${adds};

    return { scene, ${doc.objects.map((o) => varName(o.id)).join(', ')} };
  }

  mountAll('[data-${slug}]', (root) => {
    const { scene${destructure} } = buildScene();
    return mountFigure(root, {
${mountLiteral}
    });
  });
</script>
`;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
