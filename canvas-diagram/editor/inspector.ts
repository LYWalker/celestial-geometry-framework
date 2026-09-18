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
  isExpr,
  isRef,
  isXY,
  POSITIONED_KINDS,
  type DiagramDoc,
  type FaceDoc,
  type ObjectDoc,
} from './doc.js';
import { fieldsFor, GROUPS, type FieldSpec } from './fields.js';
import { rendererNames, rendererNote } from './renderers.js';
import { deletePath, getPath, setPath, type EditorState } from './state.js';

/** Which control had focus when the panel was rebuilt, so it can be given it
 * back. Module-level rather than per-panel: there is one focused element in a
 * document, and threading it through every row would be ceremony. */
let focusKey: string | null = null;
let focusCaret: number | null = null;

export function renderInspector(host: HTMLElement, state: EditorState): void {
  rememberFocus(host);
  clear(host);

  const o = state.selected();
  if (!o) {
    host.appendChild(
      el(
        'p',
        { class: 'cdx-empty' },
        'Nothing selected. Pick something in the list, or click it in the figure.',
      ),
    );
    return;
  }

  const specs = fieldsFor(o.kind).filter((f) => f.when === undefined || f.when(o));
  for (const group of GROUPS) {
    const inGroup = specs.filter((f) => f.group === group);
    if (inGroup.length === 0) continue;
    host.appendChild(el('h4', { class: 'cdx-group', text: group }));
    for (const spec of inGroup) host.appendChild(row(spec, o, state));
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
  if (state.selectedId === from) state.select(to);
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
          if (spec.path === 'id') rename(state, o.id, (e.target as HTMLInputElement).value.trim());
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
          onblur: () => state.breakCoalesce(),
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

    case 'bool':
      host.appendChild(
        el('label', { class: 'cdx-check' },
          el('input', {
            type: 'checkbox',
            'data-fkey': key,
            ...(value === true ? { checked: true } : {}),
            onchange: (e: Event) => put((e.target as HTMLInputElement).checked),
          }),
          el('span', { text: value === undefined ? (spec.fallback ?? 'not set') : value ? 'yes' : 'no' }),
        ),
      );
      break;

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
            onblur: () => state.breakCoalesce(),
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
          onblur: () => state.breakCoalesce(),
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
          onblur: () => state.breakCoalesce(),
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
        onblur: () => state.breakCoalesce(),
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
    onblur: () => state.breakCoalesce(),
  });
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
      onblur: () => state.breakCoalesce(),
    }),
    el('input', {
      type: 'text',
      'data-fkey': key,
      value: value ?? '',
      placeholder: spec.fallback ?? '',
      spellcheck: 'false',
      oninput: (e: Event) => put((e.target as HTMLInputElement).value, key),
      onblur: () => state.breakCoalesce(),
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
      onblur: () => state.breakCoalesce(),
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
              onblur: () => state.breakCoalesce(),
            })
          : null;

  return el('div', { class: 'cdx-stack' }, picker, body);
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
      ? el('div', { class: 'cdx-pair' },
          el('input', {
            type: 'number',
            'data-fkey': key,
            value: value as number,
            step: 1,
            title: 'Degrees anticlockwise from due east — 0 is right, 90 is up',
            oninput: (e: Event) => {
              const raw = (e.target as HTMLInputElement).value;
              if (raw !== '') put(Number(raw), key);
            },
            onblur: () => state.breakCoalesce(),
          }),
          el('span', { class: 'cdx-unit', text: '° from east, anticlockwise' }),
        )
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
              onblur: () => state.breakCoalesce(),
            })
          : null;

  return el('div', { class: 'cdx-stack' }, picker, body);
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
          onblur: () => state.breakCoalesce(),
        })
      : null,
  );
}
