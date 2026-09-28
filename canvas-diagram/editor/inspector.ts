/**
 * The property panel: one row per field, built from `fields.ts`.
 *
 * The whole panel is rebuilt whenever anything changes, which sounds wasteful
 * and is not: it is a few dozen rows, and rebuilding is what makes the
 * conditional fields work. `phase` should vanish the moment `angle` is set,
 * an eccentric's direction should appear the moment its ratio does — and
 * expressing that as "recompute which fields apply, then draw them" is one
 * rule, where keeping a live panel in sync would be one rule per field.
 *
 * The one thing that must survive a rebuild is the text field you are typing
 * in. `focusKey` is how: the row that had focus is given it back, caret and
 * all, so a rebuild between two keystrokes is invisible.
 *
 * Three conventions run through every control:
 *
 *  - **Empty means default, not zero.** Every optional field has a ⌫ that
 *    removes it, and its placeholder says what the scene layer will do
 *    instead. That distinction is real — `showBody: false` is not the same as
 *    "no showBody", which derives from whether the sphere turns.
 *  - **Anything that can vary has an ƒx.** One toggle, same place, on every
 *    field the scene layer types as `Scalar`, `BoolLike`, a gloss or a label
 *    direction — so "this can be a function of the frame" is a property you
 *    learn once rather than per field.
 *  - **The help is next to the control.** Hover the field's name for the line
 *    from `fields.ts`; it is the same explanation the scene layer's own source
 *    gives, which is the only documentation worth putting in a panel.
 */

import { clear, el, select } from './dom.js';
import {
  idFromName,
  isExpr,
  isRef,
  isXY,
  POSITIONED_KINDS,
  type DiagramDoc,
  type FaceDoc,
  type ObjectDoc,
  type AnchorDoc,
  type SphereDoc,
} from './doc.js';
import { fieldsFor, GROUPS, isAdvanced, unitOf, type FieldSpec } from './fields.js';
import { describeAs, formatDMS, formatLongitude, parseAs, UNIT_EXAMPLES, type Unit } from './units.js';
import { getRenderer, rendererNames, rendererNote } from './renderers.js';
import { BODIES, bodyPreset } from './bodies.js';
import { frame } from '../scene/types.js';
import { deletePath, getPath, setPath, type EditorState } from './state.js';

/** Which control had focus when the panel was rebuilt, so it can be given it
 * back. Module-level rather than per-panel: there is one focused element in a
 * document, and threading it through every row would be ceremony. */
let focusKey: string | null = null;
let focusCaret: number | null = null;

/** A one-click way to build on the selected object — "put a sphere round
 * this", "trail it" — offered at the top of its panel. */
export interface QuickAction {
  label: string;
  title: string;
  run: () => void;
}

/** What a reference field asks the canvas for when its ⌖ is pressed. */
export type StartPick = (id: string, path: string, label: string, accepts: 'point' | 'dir') => void;

export interface InspectorOptions {
  actions?: QuickAction[];
  startPick?: StartPick;
  /** shown in place of the fields when nothing is selected */
  empty?: HTMLElement;
}

/** Set for the duration of one render, so the reference controls deep inside
 * it can offer "pick on the canvas" without threading it through every row. */
let pickHandler: StartPick | undefined;

/**
 * True while the panel is being torn down to be rebuilt. Taking a focused
 * field out of the document fires its `blur` in Chrome — so without this,
 * every keystroke's rebuild would look like leaving the field: closing the
 * undo run (a step per letter), and committing whatever "leaving" commits,
 * half-typed.
 */
let rebuilding = false;

/** Whether "More options" was open, so selecting something else, or an edit
 * rebuilding the panel, does not snap it shut under you. */
let moreOpen = false;

export function renderInspector(host: HTMLElement, state: EditorState, opts: InspectorOptions = {}): void {
  rememberFocus(host);
  rebuilding = true;
  try {
    clear(host);
  } finally {
    rebuilding = false;
  }
  pickHandler = opts.startPick;

  const o = state.selected();
  if (!o) {
    host.appendChild(
      opts.empty ??
        el('p', { class: 'cdx-empty' }, 'Nothing selected. Pick something in the list, or click it in the figure.'),
    );
    return;
  }

  if (opts.actions && opts.actions.length > 0) {
    host.appendChild(el('h4', { class: 'cdx-group', text: 'Build on it' }));
    host.appendChild(
      el('div', { class: 'cdx-actions' },
        ...opts.actions.map((a) => el('button', { type: 'button', text: a.label, title: a.title, onclick: a.run })),
      ),
    );
  }

  if (o.kind === 'sphere' || o.kind === 'anchor') host.appendChild(bodySection(o, state));

  const specs = fieldsFor(o.kind).filter((f) => f.when === undefined || f.when(o, state.doc));
  const basic = specs.filter((f) => !isAdvanced(f));
  const advanced = specs.filter((f) => isAdvanced(f));

  for (const group of GROUPS) {
    const inGroup = basic.filter((f) => f.group === group);
    if (inGroup.length === 0) continue;
    host.appendChild(el('h4', { class: 'cdx-group', text: group }));
    for (const spec of inGroup) host.appendChild(row(spec, o, state));
  }

  if (advanced.length > 0) {
    const setCount = advanced.filter((f) => getPath(o, f.path) !== undefined).length;
    const more = el('details', { class: 'cdx-more', ...(moreOpen ? { open: true } : {}) },
      el('summary', { text: `More options${setCount > 0 ? ` · ${setCount} set` : ''}` }),
    );
    more.addEventListener('toggle', () => {
      moreOpen = more.open;
    });
    for (const group of GROUPS) {
      const inGroup = advanced.filter((f) => f.group === group);
      if (inGroup.length === 0) continue;
      more.appendChild(el('h4', { class: 'cdx-group', text: group }));
      for (const spec of inGroup) more.appendChild(row(spec, o, state));
    }
    host.appendChild(more);
  }

  restoreFocus(host);
}

function rememberFocus(host: HTMLElement): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && host.contains(active) && active.dataset['fkey']) {
    focusKey = active.dataset['fkey'];
    focusCaret =
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.selectionStart : null;
  } else {
    focusKey = null;
    focusCaret = null;
  }
}

function restoreFocus(host: HTMLElement): void {
  if (focusKey === null) return;
  const node = host.querySelector<HTMLElement>(`[data-fkey="${CSS.escape(focusKey)}"]`);
  if (!node) return;
  node.focus({ preventScroll: true });
  if (focusCaret !== null && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
    try {
      node.setSelectionRange(focusCaret, focusCaret);
    } catch {
      // a number input refuses setSelectionRange in some browsers; the focus
      // is the part that matters and it is already restored
    }
  }
}

/* -------------------------------------------------------------------------
 * Editing
 * ---------------------------------------------------------------------- */

function set(state: EditorState, id: string, path: string, value: unknown, coalesce?: string): void {
  state.edit(
    (doc) => {
      const target = doc.objects.find((x) => x.id === id);
      if (!target) return false;
      setPath(target as unknown as Record<string, unknown>, path, value);
    },
    { label: path, ...(coalesce !== undefined ? { coalesce } : {}) },
  );
}

function unset(state: EditorState, id: string, path: string): void {
  state.edit(
    (doc) => {
      const target = doc.objects.find((x) => x.id === id);
      if (!target) return false;
      deletePath(target as unknown as Record<string, unknown>, path);
    },
    { label: `clear ${path}` },
  );
}

/**
 * Rename an object, and every reference to it, in one edit.
 *
 * The id is how objects find each other, so changing it without following
 * through would silently break every sphere centred on this one. Doing it here
 * rather than making the user fix each reference is the difference between an
 * id being a name and an id being a commitment.
 */
function rename(state: EditorState, from: string, to: string): void {
  if (to === '' || from === to) return;
  if (state.doc.objects.some((x) => x.id === to)) return;
  // Selection first: the edit re-renders every panel, and it must find the
  // object under the name it is about to have, not the one it is losing.
  if (state.selectedId === from) state.select(to);
  state.edit(
    (doc: DiagramDoc) => {
      if (doc.objects.some((x) => x.id === to)) return false;
      const target = doc.objects.find((x) => x.id === from);
      if (!target) return false;
      target.id = to;
      retarget(doc, from, to);
    },
    { label: 'rename' },
  );
}

/** Rename an object whose id is still the one the editor made up for it, to
 * one derived from its name. An id someone chose is left alone. */
function adoptName(state: EditorState, id: string, name: string): void {
  const o = state.doc.objects.find((x) => x.id === id);
  if (!o || !new RegExp(String.raw`^${o.kind}-\d+$`).test(id)) return;
  const next = idFromName(name, new Set(state.doc.objects.map((x) => x.id)));
  if (next === null) return;
  rename(state, id, next);
}

/** Point every reference at `from` to `to` — used by rename, and by delete to
 * find what would break. Walks the document generically rather than by field
 * list, since a reference is recognisable by shape wherever it sits. */
function retarget(doc: DiagramDoc, from: string, to: string): void {
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec['ref'] === 'string' && rec['ref'] === from) rec['ref'] = to;
    for (const value of Object.values(rec)) walk(value);
  };
  walk(doc.objects);
  if (doc.view.refId === from) doc.view.refId = to;
  if (doc.view.lightId === from) doc.view.lightId = to;
  if (doc.zodiac !== false) walk(doc.zodiac);
}

/* -------------------------------------------------------------------------
 * One row
 * ---------------------------------------------------------------------- */

function row(spec: FieldSpec, o: ObjectDoc, state: EditorState): HTMLElement {
  const value = getPath(o, spec.path);
  const isSet = value !== undefined;
  const key = `${o.id}:${spec.path}`;

  const name = el('span', { class: 'cdx-fname', text: spec.label, title: spec.help ?? spec.label });
  const controls = el('div', { class: 'cdx-fcontrol' });
  buildControl(controls, spec, o, state, value, key);

  // Required fields have no "leave it at its default" — there isn't one.
  const clearable = isSet && !REQUIRED.has(spec.path) && spec.path !== 'id' && spec.path !== 'name';
  const head = el(
    'div',
    { class: 'cdx-fhead' },
    name,
    clearable
      ? el('button', {
          class: 'cdx-clear',
          type: 'button',
          title: `Leave “${spec.label}” at its default${spec.fallback ? ` (${spec.fallback})` : ''}`,
          text: '⌫',
          onclick: () => unset(state, o.id, spec.path),
        })
      : null,
  );

  return el('div', { class: `cdx-field${isSet ? ' is-set' : ''}` }, head, controls, spec.help ? el('p', { class: 'cdx-help', text: spec.help }) : null);
}

/* -------------------------------------------------------------------------
 * The body a sphere carries
 * ---------------------------------------------------------------------- */

/** The icons a body can be drawn with: a renderer, and what to call it. */
const ICONS: readonly { render: string | null; label: string }[] = [
  { render: null, label: 'a dot' },
  { render: 'lit', label: 'lit from the light source' },
  { render: 'shaded', label: 'a shaded ball' },
  { render: 'sun', label: 'a glowing sun' },
  { render: 'ringed', label: 'ringed, like Saturn' },
];

/** Whether it draws a body at all. A sphere: as set, or because it turns. A
 * point: when it has been given one, in place of its marker. */
function carriesBody(o: SphereDoc | AnchorDoc): boolean {
  if (o.kind === 'anchor') return o.render !== undefined || o.body !== undefined;
  return o.showBody ?? (o.speed !== undefined || o.angle !== undefined);
}

/** Which menu entry a sphere's body is: a known body, a custom one, or none. */
function bodyChoice(o: SphereDoc | AnchorDoc): string {
  if (!carriesBody(o)) return '';
  if (o.body !== undefined) return o.body;
  // a figure from before this was recorded: recognise a known body by its name
  return BODIES.find((b) => b.name.toLowerCase() === o.name.toLowerCase())?.key ?? 'custom';
}

/**
 * What body it is, first in its panel: none (a bare shell; a point's plain
 * marker), one of the known bodies — which brings its name, Hebrew name,
 * colour and icon — or a custom one, named in the field below and drawn with
 * the icon picked here. A sphere carries its body round its rim; a point is
 * one, where it stands.
 */
function bodySection(o: SphereDoc | AnchorDoc, state: EditorState): HTMLElement {
  const choice = bodyChoice(o);
  const edit = (fn: (t: SphereDoc | AnchorDoc) => void, label: string): void =>
    state.edit((doc) => {
      const t = doc.objects.find((x) => x.id === o.id);
      if (!t || (t.kind !== 'sphere' && t.kind !== 'anchor')) return false;
      fn(t);
    }, { label });
  /** show the body: a sphere draws one when told or when it turns */
  const showIt = (t: SphereDoc | AnchorDoc): void => {
    if (t.kind !== 'sphere') return;
    if (t.speed !== undefined || t.angle !== undefined) delete t.showBody;
    else t.showBody = true;
  };

  const menu = select(
    [
      { value: '', label: o.kind === 'sphere' ? '— nothing: a bare shell —' : '— none: just its marker —' },
      ...BODIES.map((b) => ({ value: b.key, label: b.name })),
      { value: 'custom', label: 'a custom body…' },
    ],
    choice,
    (v) => {
      state.breakCoalesce();
      const preset = bodyPreset(v);
      if (v === '') {
        edit((t) => {
          if (t.kind === 'sphere') t.showBody = false;
          else delete t.render;
          delete t.body;
        }, 'no body');
        return;
      }
      if (preset) {
        edit((t) => {
          t.body = preset.key;
          t.name = preset.name;
          t.nameHe = preset.nameHe;
          t.color = preset.color;
          t.dotSize = preset.dotSize;
          // a point needs a renderer to be a body at all; the plain one will do
          if (preset.render) t.render = { ref: preset.render };
          else if (t.kind === 'anchor') t.render = { ref: 'plain' };
          else delete t.render;
          showIt(t);
        }, `body: ${preset.name}`);
        adoptName(state, o.id, preset.name);
        return;
      }
      edit((t) => {
        t.body = 'custom';
        if (t.kind === 'anchor') t.render ??= { ref: 'plain' };
        showIt(t);
      }, 'custom body');
    },
    { 'data-fkey': `${o.id}:body`, title: o.kind === 'sphere' ? 'What rides this sphere' : 'What body this point is' },
  );

  const out = el('div', { class: 'cdx-bodysec' },
    el('h4', { class: 'cdx-group', text: 'Its body' }),
    el('div', { class: 'cdx-field is-set' }, el('div', { class: 'cdx-fcontrol' }, menu)),
  );
  if (choice === '') return out;

  // The icon: each drawn as it would be, in this body's own colour, so the
  // choice is made by looking rather than by reading renderer names.
  const color = o.color ?? state.doc.theme.body;
  const current = o.render !== undefined && isRef(o.render) && o.render.ref !== 'plain' ? o.render.ref : null;
  const icons = el('div', { class: 'cdx-icons' });
  for (const icon of ICONS) {
    const on = icon.render === current;
    const canvas = el('canvas', { width: 56, height: 56 });
    drawIcon(canvas, icon.render, color);
    icons.appendChild(
      el('button', {
        type: 'button',
        class: `cdx-icon${on ? ' is-on' : ''}`,
        title: icon.label,
        'aria-pressed': on ? 'true' : 'false',
        onclick: () =>
          edit((t) => {
            // a point keeps a renderer even as a dot: without one it is a marker again
            if (icon.render !== null) t.render = { ref: icon.render };
            else if (t.kind === 'anchor') t.render = { ref: 'plain' };
            else delete t.render;
            // a known body drawn differently is no longer quite that body
            const preset = bodyPreset(t.body);
            if (preset && (preset.render ?? null) !== icon.render) t.body = 'custom';
          }, 'icon'),
      }, canvas),
    );
  }
  icons.appendChild(
    el('input', {
      type: 'color',
      class: 'cdx-icon-color',
      value: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#e9e6df',
      title: 'Its colour',
      oninput: (e: Event) => set(state, o.id, 'color', (e.target as HTMLInputElement).value, `${o.id}:color`),
      onchange: () => state.breakCoalesce(),
    }),
  );
  out.appendChild(
    el('div', { class: 'cdx-field is-set' },
      el('div', { class: 'cdx-fhead' }, el('span', { class: 'cdx-fname', text: 'Icon' })),
      el('div', { class: 'cdx-fcontrol' }, icons),
      choice === 'custom' ? el('p', { class: 'cdx-note', text: 'Name it just below.' }) : null,
    ),
  );
  return out;
}

/** One icon, drawn by its renderer exactly as the figure will draw it, lit
 * from the upper left — at twice the size it is shown, for a sharp preview. */
function drawIcon(canvas: HTMLCanvasElement, render: string | null, color: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const renderer = getRenderer(render ?? 'plain');
  if (!renderer) return;
  ctx.save();
  ctx.scale(2, 2);
  renderer(ctx, {
    screen: { x: 14, y: 14 },
    world: { x: 0, y: 0 },
    r: render === 'sun' ? 5.5 : 6,
    f: frame(0),
    camera: { zoom: 1, pan: { x: 0, y: 0 }, cx: 0, cy: 0 },
    color,
    hot: false,
    alpha: 1,
    light: { x: -0.8, y: -0.6 },
  });
  ctx.restore();
}

/** What an unset checkbox field does anyway. */
function boolDefault(spec: FieldSpec, o: ObjectDoc): boolean {
  // a sphere draws its body when something turns it
  if (spec.path === 'showBody' && o.kind === 'sphere') return o.speed !== undefined || o.angle !== undefined;
  // an angle is a correction unless told otherwise
  if (spec.path === 'short') return true;
  return spec.fallback?.startsWith('yes') ?? false;
}

/** Fields the scene layer has no default for — clearing them would produce an
 * object that cannot be built. */
const REQUIRED = new Set(['radius', 'vertex', 'from', 'to', 'toward', 'target', 'span', 'step']);

function buildControl(
  host: HTMLElement,
  spec: FieldSpec,
  o: ObjectDoc,
  state: EditorState,
  value: unknown,
  key: string,
): void {
  const put = (v: unknown, coalesce?: string): void => set(state, o.id, spec.path, v, coalesce);

  switch (spec.type) {
    case 'text': {
      const input = el('input', {
        type: 'text',
        'data-fkey': key,
        value: (value as string) ?? '',
        placeholder: spec.fallback ?? '',
        oninput: (e: Event) => {
          const next = (e.target as HTMLInputElement).value;
          if (spec.path === 'id') return; // committed on blur — see below
          put(next, key);
        },
        onblur: (e: Event) => {
          if (rebuilding) return;
          if (spec.path === 'id') rename(state, o.id, (e.target as HTMLInputElement).value.trim());
          // An object still under the id it was born with (`sphere-2`) takes
          // one from its name once it has a name — so the emitted code says
          // `const moonsEpicycle`, not `const sphere2`, without anyone having
          // to know ids exist.
          if (spec.path === 'name') adoptName(state, o.id, (e.target as HTMLInputElement).value);
          state.breakCoalesce();
        },
      });
      // An id is committed on blur rather than per keystroke: renaming updates
      // every reference in the figure, and doing that on the way through
      // "moo", "moon" would retarget half of them to an id nobody meant.
      host.appendChild(input);
      break;
    }

    case 'prose':
      host.appendChild(
        el('textarea', {
          'data-fkey': key,
          rows: 3,
          placeholder: spec.fallback ?? '',
          oninput: (e: Event) => put((e.target as HTMLTextAreaElement).value, key),
          onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
          text: (value as string) ?? '',
        }),
      );
      break;

    case 'color':
      host.appendChild(colorControl(value as string | undefined, spec, key, put, state));
      break;

    case 'number':
      host.appendChild(numberInput(value as number | undefined, spec, key, put, state));
      break;

    case 'scalar':
      host.appendChild(withExpr(value, spec, key, put, state, () => numberInput(value as number | undefined, spec, key, put, state)));
      break;

    case 'bool': {
      // Unset, the box shows what the scene layer will do anyway — a ticked
      // box labelled "yes" and an empty one labelled "yes" are not the same.
      const effective = value === undefined ? boolDefault(spec, o) : value === true;
      host.appendChild(
        el('label', { class: 'cdx-check' },
          el('input', {
            type: 'checkbox',
            'data-fkey': key,
            ...(effective ? { checked: true } : {}),
            onchange: (e: Event) => put((e.target as HTMLInputElement).checked),
          }),
          el('span', { text: value === undefined ? `${effective ? 'yes' : 'no'} (default)` : value ? 'yes' : 'no' }),
        ),
      );
      break;
    }

    case 'boolLike':
      host.appendChild(
        withExpr(value, spec, key, put, state, () =>
          el('label', { class: 'cdx-check' },
            el('input', {
              type: 'checkbox',
              'data-fkey': key,
              ...(value === true ? { checked: true } : {}),
              onchange: (e: Event) => put((e.target as HTMLInputElement).checked),
            }),
            el('span', { text: value === undefined ? (spec.fallback ?? 'not set') : value ? 'yes' : 'no' }),
          ),
        ),
      );
      break;

    case 'enum':
      host.appendChild(
        select(
          [{ value: '', label: `— ${spec.fallback ?? 'default'} —` }, ...(spec.options ?? []).map((v) => ({ value: v, label: v }))],
          (value as string) ?? '',
          (v) => (v === '' ? unset(state, o.id, spec.path) : put(v)),
          { 'data-fkey': key },
        ),
      );
      break;

    case 'point':
      host.appendChild(pointControl(value, spec, o, state, key, put));
      break;

    case 'dir':
      host.appendChild(dirControl(value, spec, o, state, key, put));
      break;

    case 'textLike':
      host.appendChild(
        withExpr(value, spec, key, put, state, () =>
          el('input', {
            type: 'text',
            'data-fkey': key,
            value: (value as string) ?? '',
            placeholder: spec.fallback ?? '',
            oninput: (e: Event) => put((e.target as HTMLInputElement).value, key),
            onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
          }),
        ),
      );
      break;

    case 'vec':
      host.appendChild(
        withExpr(value, spec, key, put, state, () => {
          const v = isXY(value) ? value : { x: 1, y: 0 };
          return el('div', { class: 'cdx-pair' },
            numField(v.x, 0.1, (n) => put({ x: n, y: v.y }, key), `${key}:x`, 'x'),
            numField(v.y, 0.1, (n) => put({ x: v.x, y: n }, key), `${key}:y`, 'y'),
          );
        }),
      );
      break;

    case 'expr':
      host.appendChild(
        el('input', {
          type: 'text',
          class: 'cdx-expr',
          'data-fkey': key,
          spellcheck: 'false',
          value: isExpr(value) ? value.expr : '',
          placeholder: spec.fallback ?? 'an expression',
          oninput: (e: Event) => {
            const text = (e.target as HTMLInputElement).value;
            if (text.trim() === '') unset(state, o.id, spec.path);
            else put({ expr: text }, key);
          },
          onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
        }),
      );
      break;

    case 'renderer':
      host.appendChild(rendererControl(value, spec, o, state, key, put));
      break;

    case 'face':
      host.appendChild(faceControl(value as FaceDoc | undefined, spec, key, put, state));
      break;

    case 'keys':
      host.appendChild(
        el('input', {
          type: 'text',
          'data-fkey': key,
          value: Array.isArray(value) ? (value as string[]).join(', ') : '',
          placeholder: spec.fallback ?? '',
          oninput: (e: Event) => {
            const parts = (e.target as HTMLInputElement).value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s !== '');
            put(parts, key);
          },
          onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
        }),
      );
      break;

    case 'reach': {
      const v = (value as { in: number; out: number } | undefined) ?? { in: 7, out: 6 };
      host.appendChild(
        el('div', { class: 'cdx-pair' },
          numField(v.in, 1, (n) => put({ in: n, out: v.out }, key), `${key}:in`, 'in'),
          numField(v.out, 1, (n) => put({ in: v.in, out: n }, key), `${key}:out`, 'out'),
        ),
      );
      break;
    }
  }
}

/* -------------------------------------------------------------------------
 * The pieces controls are made of
 * ---------------------------------------------------------------------- */

/**
 * Wrap a control in the ƒx toggle: the same switch, in the same place, on
 * every field that the scene layer lets vary with the frame.
 *
 * Switching to an expression seeds it with the value that was there, so
 * turning a fixed `120` into a function starts from `120` rather than from a
 * blank — which is usually one edit away from what was wanted.
 */
function withExpr(
  value: unknown,
  spec: FieldSpec,
  key: string,
  put: (v: unknown, coalesce?: string) => void,
  state: EditorState,
  plain: () => HTMLElement,
): HTMLElement {
  const on = isExpr(value);
  const toggle = el('button', {
    class: `cdx-fx${on ? ' is-on' : ''}`,
    type: 'button',
    text: 'ƒx',
    title: on ? 'Back to a fixed value' : 'Make this a function of the frame — the clock, and any parameter',
    onclick: () => {
      state.breakCoalesce();
      if (on) {
        // Coming back from an expression cannot recover a number, so it lands
        // on something harmless and visible rather than guessing.
        put(spec.type === 'boolLike' ? false : 0);
      } else {
        put({ expr: seedExpr(value, spec) });
      }
    },
  });

  const body = on
    ? el('input', {
        type: 'text',
        class: 'cdx-expr',
        'data-fkey': key,
        spellcheck: 'false',
        value: (value as { expr: string }).expr,
        oninput: (e: Event) => put({ expr: (e.target as HTMLInputElement).value }, key),
        onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
      })
    : plain();

  return el('div', { class: 'cdx-fx-row' }, body, toggle);
}

function seedExpr(value: unknown, spec: FieldSpec): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return `'${value}'`;
  if (isXY(value)) return `{ x: ${value.x}, y: ${value.y} }`;
  return spec.type === 'boolLike' ? 'f.t > 0' : 'f.t';
}

function numberInput(
  value: number | undefined,
  spec: FieldSpec,
  key: string,
  put: (v: unknown, coalesce?: string) => void,
  state: EditorState,
): HTMLElement {
  const o = state.selected();
  const unit = o ? unitOf(spec, o) : undefined;
  if (unit) return preciseInput(value, unit, spec, key, put, state, o ? senseToggle(spec, o, state) : null);
  return el('input', {
    type: 'number',
    'data-fkey': key,
    value: value ?? '',
    placeholder: spec.fallback ?? '',
    step: spec.step ?? 1,
    ...(spec.min !== undefined ? { min: spec.min } : {}),
    ...(spec.max !== undefined ? { max: spec.max } : {}),
    oninput: (e: Event) => {
      const raw = (e.target as HTMLInputElement).value;
      if (raw === '') return;
      put(Number(raw), key);
    },
    onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
  });
}

/**
 * A number stated precisely, in whatever form its source uses.
 *
 * Text, not `type=number`: `13°10′35″`, `26°45′ Gemini` and `2;30/60` are
 * all numbers, and a number box refuses every one of them. It commits on
 * Enter or on leaving the field rather than per keystroke, because "13°1" is
 * on the way to "13°10′35″" and not a value anyone meant; until then the line
 * beneath says what it will be read as, so a typo shows before it lands.
 */
function preciseInput(
  value: number | undefined,
  unit: Unit,
  spec: FieldSpec,
  key: string,
  put: (v: unknown, coalesce?: string) => void,
  state: EditorState,
  extra: HTMLElement | null,
): HTMLElement {
  const clockUnit = (state.doc.clock.unit ?? 'day').replace(/s$/, '') || 'day';
  const shown = value === undefined ? '' : formatAs(unit, value);
  const readout = el('div', { class: 'cdx-readout' });
  const say = (v: number | null, typed: string): void => {
    if (v === null) {
      readout.textContent = typed.trim() === '' ? '' : `Can’t read that — try ${UNIT_EXAMPLES[unit]}`;
      readout.classList.toggle('is-bad', typed.trim() !== '');
      return;
    }
    readout.classList.remove('is-bad');
    // a motion's sense lives beside it, in `clockwise`, and the readout says it
    const o = state.selected();
    const sense = unit === 'rate' && o?.kind === 'sphere' && o.clockwise === true ? -1 : 1;
    readout.textContent = `= ${describeAs(unit, v * sense, clockUnit)}`;
  };

  const commit = (): void => {
    const text = input.value.trim();
    // left as it was shown: nothing was typed, and re-reading a rounded
    // display would nudge an exact value by its last shown digit
    if (text === shown || text === '') return;
    const v = parseAs(unit, text);
    if (v === null) return;
    state.breakCoalesce();
    put(v);
  };

  const input = el('input', {
    type: 'text',
    class: 'cdx-precise',
    'data-fkey': key,
    value: shown,
    placeholder: spec.fallback ?? UNIT_EXAMPLES[unit],
    spellcheck: 'false',
    title: `Type it as your source gives it — ${UNIT_EXAMPLES[unit]}`,
    oninput: () => say(parseAs(unit, input.value), input.value),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        input.value = shown;
        say(value ?? null, shown);

  // A button beside the box (↻) must not steal focus on the way to being
  // clicked: the blur would commit and rebuild the panel under the pointer,
  // and the click would land on nothing. So it keeps focus where it is, and
  // commits whatever was typed before doing its own thing.
  if (extra) {
    extra.addEventListener('pointerdown', (e) => e.preventDefault());
    extra.addEventListener('click', () => commit(), { capture: true });
  }
      }
    },
    onblur: () => {
      if (!rebuilding) commit();
    },
  });
  say(value ?? null, shown);

  return el('div', { class: 'cdx-stack' }, extra ? el('div', { class: 'cdx-fx-row' }, input, extra) : input, readout);
}

/**
 * ↺ or ↻ beside a sphere's motion. Which way it turns is a property of the
 * motion, not a digit of it — so it is a switch beside the number, rather
 * than a minus sign someone has to know to type (and then remember applies
 * to the starting point too).
 */
function senseToggle(spec: FieldSpec, o: ObjectDoc, state: EditorState): HTMLElement | null {
  if (spec.path !== 'speed' || o.kind !== 'sphere') return null;
  const cw = o.clockwise === true;
  return el('button', {
    type: 'button',
    class: 'cdx-sense',
    text: cw ? '↻' : '↺',
    title: cw ? 'Turns clockwise — press for anticlockwise' : 'Turns anticlockwise — press for clockwise',
    onclick: () => {
      state.breakCoalesce();
      if (cw) unset(state, o.id, 'clockwise');
      else set(state, o.id, 'clockwise', true);
    },
  });
}

/** How a value is shown in its box: the form the sources use, to enough
 * places that nothing typed is lost to the display. */
function formatAs(unit: Unit, v: number): string {
  switch (unit) {
    case 'angle':
      return formatDMS(v, 2);
    case 'bearing':
      return formatLongitude(v, 2);
    case 'rate':
      return formatDMS(v, 2);
    case 'ratio':
    case 'length':
      return String(Math.round(v * 1e8) / 1e8);
  }
}

function numField(value: number, step: number, onChange: (n: number) => void, key: string, label: string): HTMLElement {
  return el('label', { class: 'cdx-sub' },
    el('span', { text: label }),
    el('input', {
      type: 'number',
      'data-fkey': key,
      value,
      step,
      oninput: (e: Event) => {
        const raw = (e.target as HTMLInputElement).value;
        if (raw !== '') onChange(Number(raw));
      },
    }),
  );
}

/**
 * A colour, as both a swatch and its text.
 *
 * Both, not either: half the colours in these figures are `rgba(...)` with an
 * alpha that a colour input cannot express, and the other half are hex codes
 * that nobody wants to type. The swatch edits what it can and the text field
 * always says exactly what the document holds.
 */
function colorControl(
  value: string | undefined,
  spec: FieldSpec,
  key: string,
  put: (v: unknown, coalesce?: string) => void,
  state: EditorState,
): HTMLElement {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? (value as string) : '#9fb3d9';
  return el('div', { class: 'cdx-color' },
    el('input', {
      type: 'color',
      value: hex,
      title: 'Pick a colour — for one with transparency, type it beside this',
      oninput: (e: Event) => put((e.target as HTMLInputElement).value, key),
      onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
    }),
    el('input', {
      type: 'text',
      'data-fkey': key,
      value: value ?? '',
      placeholder: spec.fallback ?? '',
      spellcheck: 'false',
      oninput: (e: Event) => put((e.target as HTMLInputElement).value, key),
      onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
    }),
  );
}

function faceControl(
  value: FaceDoc | undefined,
  spec: FieldSpec,
  key: string,
  put: (v: unknown, coalesce?: string) => void,
  state: EditorState,
): HTMLElement {
  const face = value ?? { css: '500 11px system-ui, sans-serif', px: 11 };
  return el('div', { class: 'cdx-pair' },
    el('input', {
      type: 'text',
      class: 'cdx-grow',
      'data-fkey': key,
      value: face.css,
      placeholder: spec.fallback ?? 'a CSS font shorthand',
      spellcheck: 'false',
      oninput: (e: Event) => put({ css: (e.target as HTMLInputElement).value, px: face.px }, key),
      onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
    }),
    numField(face.px, 0.5, (px) => put({ css: face.css, px }, key), `${key}:px`, 'px'),
  );
}

/** The objects a reference may point at: those that have a place, and not this
 * one, which would be a cycle of length one. */
function refOptions(doc: DiagramDoc, selfId: string): { value: string; label: string }[] {
  return doc.objects
    .filter((x) => POSITIONED_KINDS.includes(x.kind) && x.id !== selfId)
    .map((x) => ({ value: x.id, label: `${x.name} — ${x.id}` }));
}

/**
 * A `PointLike`: another object, a fixed point, or an expression.
 *
 * The mode picker comes first and the payload follows it, because which of the
 * three this is, is the decision — "centred on the earth" and "centred at
 * (40, 0)" are different kinds of statement about the figure, not different
 * spellings of one.
 */
function pointControl(
  value: unknown,
  spec: FieldSpec,
  o: ObjectDoc,
  state: EditorState,
  key: string,
  put: (v: unknown, coalesce?: string) => void,
): HTMLElement {
  const mode = isRef(value) ? 'ref' : isExpr(value) ? 'expr' : isXY(value) ? 'xy' : 'none';
  const options = refOptions(state.doc, o.id);

  const picker = select(
    [
      { value: 'none', label: `— ${spec.fallback ?? 'not set'} —` },
      { value: 'ref', label: 'on an object', disabled: options.length === 0 },
      { value: 'xy', label: 'at a point' },
      { value: 'expr', label: 'an expression' },
    ],
    mode,
    (m) => {
      state.breakCoalesce();
      if (m === 'none') put(undefined);
      else if (m === 'ref') put({ ref: options[0]?.value ?? '' });
      else if (m === 'xy') put({ x: 0, y: 0 });
      else put({ expr: '{ x: 0, y: 0 }' });
      if (m === 'none') {
        // `put(undefined)` would write the key as undefined; removing it is
        // what "not set" means, and the two are not the same here.
        state.edit((doc) => {
          const target = doc.objects.find((x) => x.id === o.id);
          if (!target) return false;
          delete (target as unknown as Record<string, unknown>)[spec.path.split('.')[0]!];
        });
      }
    },
  );

  const body =
    mode === 'ref'
      ? select(options, (value as { ref: string }).ref, (v) => put({ ref: v }), { 'data-fkey': key })
      : mode === 'xy'
        ? el('div', { class: 'cdx-pair' },
            numField((value as { x: number }).x, 1, (n) => put({ x: n, y: (value as { y: number }).y }, key), `${key}:x`, 'x'),
            numField((value as { y: number }).y, 1, (n) => put({ x: (value as { x: number }).x, y: n }, key), `${key}:y`, 'y'),
          )
        : mode === 'expr'
          ? el('input', {
              type: 'text',
              class: 'cdx-expr',
              'data-fkey': key,
              spellcheck: 'false',
              value: (value as { expr: string }).expr,
              oninput: (e: Event) => put({ expr: (e.target as HTMLInputElement).value }, key),
              onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
            })
          : null;

  return el('div', { class: 'cdx-stack' }, withPick(picker, o, spec, 'point'), body);
}

/** The reference picker, with a ⌖ beside it that hands the choice to the
 * canvas: press it, click the thing you mean. Choosing "the sun" out of a
 * list of ids is the slow way to say what pointing at it says at once. */
function withPick(picker: HTMLElement, o: ObjectDoc, spec: FieldSpec, accepts: 'point' | 'dir'): HTMLElement {
  if (!pickHandler) return picker;
  const start = pickHandler;
  return el('div', { class: 'cdx-fx-row' },
    picker,
    el('button', {
      class: 'cdx-pick',
      type: 'button',
      text: 'Pick',
      title: `Pick “${spec.label}” on the canvas — click the object you mean`,
      onclick: () => start(o.id, spec.path, spec.label, accepts),
    }),
  );
}

/** A `DirectionLike`: a bearing, an object to sight at, or an expression.
 * Degrees run anticlockwise from due east, the same convention the geometry
 * uses — 0 is right, 90 is up — which the control says out loud, because it is
 * the one thing about these figures that is easy to get backwards. */
function dirControl(
  value: unknown,
  spec: FieldSpec,
  o: ObjectDoc,
  state: EditorState,
  key: string,
  put: (v: unknown, coalesce?: string) => void,
): HTMLElement {
  const mode = isRef(value) ? 'ref' : isExpr(value) ? 'expr' : typeof value === 'number' ? 'deg' : 'none';
  const options = refOptions(state.doc, o.id);

  const picker = select(
    [
      ...(spec.fallback !== undefined || !REQUIRED.has(spec.path) ? [{ value: 'none', label: `— ${spec.fallback ?? 'not set'} —` }] : []),
      { value: 'deg', label: 'a bearing' },
      { value: 'ref', label: 'toward an object', disabled: options.length === 0 },
      { value: 'expr', label: 'an expression' },
    ],
    mode,
    (m) => {
      state.breakCoalesce();
      if (m === 'deg') put(0);
      else if (m === 'ref') put({ ref: options[0]?.value ?? '' });
      else if (m === 'expr') put({ expr: 'f.t * 10' });
      else {
        state.edit((doc) => {
          const target = doc.objects.find((x) => x.id === o.id);
          if (!target) return false;
          delete (target as unknown as Record<string, unknown>)[spec.path.split('.')[0]!];
        });
      }
    },
  );

  const body =
    mode === 'deg'
      ? preciseInput(value as number, unitOf(spec, o) ?? 'bearing', spec, key, put, state, null)
      : mode === 'ref'
        ? select(options, (value as { ref: string }).ref, (v) => put({ ref: v }), { 'data-fkey': key })
        : mode === 'expr'
          ? el('input', {
              type: 'text',
              class: 'cdx-expr',
              'data-fkey': key,
              spellcheck: 'false',
              value: (value as { expr: string }).expr,
              oninput: (e: Event) => put({ expr: (e.target as HTMLInputElement).value }, key),
              onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
            })
          : null;

  return el('div', { class: 'cdx-stack' }, withPick(picker, o, spec, 'dir'), body);
}

function rendererControl(
  value: unknown,
  spec: FieldSpec,
  o: ObjectDoc,
  state: EditorState,
  key: string,
  put: (v: unknown, coalesce?: string) => void,
): HTMLElement {
  const mode = isRef(value) ? 'named' : isExpr(value) ? 'expr' : 'none';
  const names = rendererNames();
  const current = isRef(value) ? value.ref : '';

  const picker = select(
    [
      { value: '', label: `— ${spec.fallback ?? 'default'} —` },
      ...names.map((n) => ({ value: n, label: n })),
      { value: 'ƒ', label: 'written here…' },
    ],
    mode === 'expr' ? 'ƒ' : current,
    (v) => {
      state.breakCoalesce();
      if (v === '') {
        state.edit((doc) => {
          const target = doc.objects.find((x) => x.id === o.id);
          if (!target) return false;
          delete (target as unknown as Record<string, unknown>)['render'];
        });
      } else if (v === 'ƒ') {
        put({ expr: '(ctx, b) => { /* screen-space drawing */ }' });
      } else {
        put({ ref: v });
      }
    },
    { 'data-fkey': key },
  );

  const note = mode === 'named' ? rendererNote(current) : undefined;
  return el('div', { class: 'cdx-stack' },
    picker,
    note ? el('p', { class: 'cdx-help', text: note }) : null,
    mode === 'expr'
      ? el('input', {
          type: 'text',
          class: 'cdx-expr',
          'data-fkey': `${key}:expr`,
          spellcheck: 'false',
          value: (value as { expr: string }).expr,
          oninput: (e: Event) => put({ expr: (e.target as HTMLInputElement).value }, key),
          onblur: () => {
          if (!rebuilding) state.breakCoalesce();
        },
        })
      : null,
  );
}
