/**
 * The panel for everything that is not one object: what the figure is called,
 * what the camera holds still, the ring at its edge, the sky behind it, the
 * palette its labels are set in, and the parameters its expressions read.
 *
 * It is a separate panel rather than a section of the inspector because it is
 * a different kind of decision. Editing a sphere is editing the figure's
 * *content*; editing the ring or the theme is editing the figure's *terms* —
 * the things every object is then drawn against. Mixing them into one scroll
 * would make the inspector a place to hunt through rather than a place to
 * look.
 *
 * The parameters section is the one that repays reading. A figure whose
 * expressions say `f.shellT` needs `shellT` to come from somewhere, and
 * declaring it here is what makes the slider appear, puts the key in scope,
 * and tells the emitter which keys to write into the `frame()` call. Adding a
 * parameter is the whole of what it takes to give a figure a mode it can
 * crossfade between.
 */

import { clear, el, select } from './dom.js';
import { DEFAULT_BACKGROUND, MAZALOT, type DiagramDoc, type ParamDoc, type ThemeDoc } from './doc.js';
import { POSITIONED_KINDS } from './doc.js';
import type { EditorState } from './state.js';

export function renderFigurePanel(host: HTMLElement, state: EditorState): void {
  clear(host);
  const doc = state.doc;

  host.appendChild(el('h4', { class: 'cdx-group', text: 'The figure' }));
  host.appendChild(
    textRow('Name', doc.name, 'What it is called — and the name of the file it emits as.', (v) =>
      state.edit((d) => {
        d.name = v;
      }, { label: 'name', coalesce: 'doc:name' }),
    ),
  );
  host.appendChild(
    proseRow('Description', doc.description ?? '', 'The note at the top of the emitted file, and the figure’s own caption.', (v) =>
      state.edit((d) => {
        d.description = v;
      }, { label: 'description', coalesce: 'doc:desc' }),
    ),
  );

  /* ---- the view ---- */
  host.appendChild(el('h4', { class: 'cdx-group', text: 'The view' }));

  const positioned = doc.objects.filter((o) => POSITIONED_KINDS.includes(o.kind));
  host.appendChild(
    row(
      'Camera holds still',
      select(
        [{ value: '', label: '— the origin —' }, ...positioned.map((o) => ({ value: o.id, label: `${o.name} — ${o.id}` }))],
        doc.view.refId ?? '',
        (v) =>
          state.edit((d) => {
            if (v === '') delete d.view.refId;
            else d.view.refId = v;
          }, { label: 'camera ref' }),
      ),
      'Pan and zoom are taken about this point, and it is what a trail’s positions are drawn against.',
    ),
  );
  host.appendChild(
    row(
      'Light comes from',
      select(
        [{ value: '', label: '— nowhere —' }, ...positioned.map((o) => ({ value: o.id, label: `${o.name} — ${o.id}` }))],
        doc.view.lightId ?? '',
        (v) =>
          state.edit((d) => {
            if (v === '') delete d.view.lightId;
            else d.view.lightId = v;
          }, { label: 'light' }),
      ),
      'Needed by any body drawn with a lit renderer — without it, a lit body draws as a plain disc rather than being lit from nowhere in particular.',
    ),
  );
  host.appendChild(
    row(
      'Fit to',
      el('div', { class: 'cdx-pair' },
        select(
          [
            { value: 'auto', label: 'whatever the figure reaches' },
            { value: 'fixed', label: 'a fixed radius' },
          ],
          doc.view.fitRadius === 'auto' ? 'auto' : 'fixed',
          (v) =>
            state.edit((d) => {
              d.view.fitRadius = v === 'auto' ? 'auto' : 160;
            }, { label: 'fit' }),
        ),
        doc.view.fitRadius === 'auto'
          ? null
          : numberInput(doc.view.fitRadius, 5, (n) =>
              state.edit((d) => {
                d.view.fitRadius = n;
              }, { label: 'fit', coalesce: 'doc:fit' }),
            ),
      ),
      'How much of the world fills the frame. Automatic re-measures the scene (and its ring) on every resize, which is what most figures want.',
    ),
  );

  /* ---- the clock ---- */
  host.appendChild(el('h4', { class: 'cdx-group', text: 'The clock' }));
  host.appendChild(
    row(
      'Speed',
      numberInput(doc.clock.speed, 0.1, (n) =>
        state.edit((d) => {
          d.clock.speed = n;
        }, { label: 'clock speed', coalesce: 'doc:speed' }),
      ),
      'Units of the clock per real second. Every sphere’s speed is stated in degrees per one of those units, so this is where “one unit is a day” is decided.',
    ),
  );
  host.appendChild(
    row(
      'One unit is',
      el('input', {
        type: 'text',
        value: doc.clock.unit ?? '',
        placeholder: 'days, seconds…',
        oninput: (e: Event) =>
          state.edit((d) => {
            d.clock.unit = (e.target as HTMLInputElement).value;
          }, { label: 'clock unit', coalesce: 'doc:unit' }),
      }),
      'Shown beside the scrubber. Prose, not arithmetic — it changes nothing about the figure.',
    ),
  );
  host.appendChild(
    row(
      'Scrubber reaches',
      numberInput(doc.clock.scrub ?? 400, 10, (n) =>
        state.edit((d) => {
          d.clock.scrub = n;
        }, { label: 'scrub', coalesce: 'doc:scrub' }),
      ),
      'How far the editor’s own time slider goes. A figure about a month wants a different range from one about a year.',
    ),
  );
  host.appendChild(
    checkRow('Runs on its own', doc.clock.running, 'Whether the emitted figure animates as soon as it loads.', (v) =>
      state.edit((d) => {
        d.clock.running = v;
      }, { label: 'running' }),
    ),
  );

  /* ---- parameters ---- */
  host.appendChild(el('h4', { class: 'cdx-group', text: 'Parameters' }));
  host.appendChild(
    el('p', { class: 'cdx-help', text: 'Named inputs besides the clock that this figure’s expressions can read — write f.yourKey. Each one gets a slider here and in the emitted figure. This is how a figure gets a mode it can fade between.' }),
  );
  for (const [i, p] of doc.params.entries()) host.appendChild(paramRow(p, i, state));
  host.appendChild(
    el('button', {
      class: 'cdx-add',
      type: 'button',
      text: '+ a parameter',
      onclick: () =>
        state.edit((d) => {
          d.params.push({ key: uniqueKey(d), label: 'How much', control: 'range', min: 0, max: 1, step: 0.01, value: 0 });
        }, { label: 'add parameter' }),
    }),
  );

  /* ---- the sky ---- */
  host.appendChild(el('h4', { class: 'cdx-group', text: 'The sky behind it' }));
  host.appendChild(
    checkRow('Draw a background', doc.background !== false, 'The gradient, the starfield and the vignette every figure in this kit sits on.', (v) =>
      state.edit((d) => {
        d.background = v ? structuredClone(DEFAULT_BACKGROUND) : false;
      }, { label: 'background' }),
    ),
  );
  if (doc.background !== false) {
    const bg = doc.background;
    for (const [key, help] of [
      ['mid', 'the gradient at the centre'],
      ['deep', 'the gradient at the edge'],
      ['star', 'the stars'],
      ['vignette', 'the vignette, at its outer edge'],
    ] as const) {
      host.appendChild(
        row(
          key,
          colorInput(bg[key], (v) =>
            state.edit((d) => {
              if (d.background !== false) d.background[key] = v;
            }, { label: `background ${key}`, coalesce: `doc:bg:${key}` }),
          ),
          help,
        ),
      );
    }
  }

  /* ---- the ring ---- */
  host.appendChild(el('h4', { class: 'cdx-group', text: 'The ring at its edge' }));
  host.appendChild(
    checkRow('Draw a ring', doc.zodiac !== false, 'A band of named segments the figure is read against — the twelve signs, usually.', (v) =>
      state.edit((d) => {
        d.zodiac = v
          ? { radius: 'auto', padding: 22, band: 20, segments: MAZALOT.map((s) => ({ ...s })), language: 'en' }
          : false;
      }, { label: 'ring' }),
    ),
  );
  if (doc.zodiac !== false) {
    const z = doc.zodiac;
    host.appendChild(
      row(
        'Sized',
        el('div', { class: 'cdx-pair' },
          select(
            [
              { value: 'auto', label: 'to the figure' },
              { value: 'fixed', label: 'to a radius' },
            ],
            z.radius === undefined || z.radius === 'auto' ? 'auto' : 'fixed',
            (v) =>
              state.edit((d) => {
                if (d.zodiac !== false) d.zodiac.radius = v === 'auto' ? 'auto' : 180;
              }, { label: 'ring radius' }),
          ),
          typeof z.radius === 'number'
            ? numberInput(z.radius, 5, (n) =>
                state.edit((d) => {
                  if (d.zodiac !== false) d.zodiac.radius = n;
                }, { label: 'ring radius', coalesce: 'doc:ringr' }),
              )
            : numberInput(z.padding ?? 28, 2, (n) =>
                state.edit((d) => {
                  if (d.zodiac !== false) d.zodiac.padding = n;
                }, { label: 'ring padding', coalesce: 'doc:ringpad' }),
              ),
        ),
        z.radius === undefined || z.radius === 'auto'
          ? 'Clear world px between the furthest thing in the figure and the ring’s inner edge.'
          : 'The ring’s inner radius, world px.',
      ),
    );
    host.appendChild(
      row(
        'Follows a moving figure',
        select(
          [
            { value: 'frame', label: 're-measured every frame' },
            { value: 'grow', label: 'opens to the furthest it ever reaches' },
          ],
          z.fit ?? 'frame',
          (v) =>
            state.edit((d) => {
              if (d.zodiac !== false) d.zodiac.fit = v as 'frame' | 'grow';
            }, { label: 'ring fit' }),
        ),
        'An orrery whose outermost planet swings with its eccentricity wants the second, or the ring breathes in and out around it.',
      ),
    );
    host.appendChild(
      row(
        'Band width',
        numberInput(z.band ?? 20, 1, (n) =>
          state.edit((d) => {
            if (d.zodiac !== false) d.zodiac.band = n;
          }, { label: 'ring band', coalesce: 'doc:ringband' }),
        ),
        'How wide the band of names is, world px.',
      ),
    );
    host.appendChild(
      row(
        'Names in',
        select(
          [
            { value: 'en', label: 'English' },
            { value: 'he', label: 'Hebrew' },
          ],
          z.language ?? 'en',
          (v) =>
            state.edit((d) => {
              if (d.zodiac !== false) d.zodiac.language = v as 'en' | 'he';
            }, { label: 'ring language' }),
        ),
      ),
    );
    host.appendChild(
      row('Ring colour', colorInput(z.color ?? 'rgba(150,168,214,0.22)', (v) =>
        state.edit((d) => {
          if (d.zodiac !== false) d.zodiac.color = v;
        }, { label: 'ring colour', coalesce: 'doc:ringcol' }),
      ), 'The two edges and the dial marks. Faint by nature — it is a backdrop.'),
    );
    host.appendChild(
      row('Name colour', colorInput(z.labelColor ?? 'rgba(223,231,251,0.92)', (v) =>
        state.edit((d) => {
          if (d.zodiac !== false) d.zodiac.labelColor = v;
        }, { label: 'ring label colour', coalesce: 'doc:ringlab' }),
      ), 'Much less faint than the ring itself: a faint line still reads as a line, a faint word does not read at all.'),
    );
    host.appendChild(
      checkRow('Draw the constellations', z.constellations !== undefined && z.constellations !== false,
        'The stars themselves, in a band outside the names. Worth knowing: the constellations are not the signs, and drawing both shows how far they have slid apart.',
        (v) =>
          state.edit((d) => {
            if (d.zodiac === false) return false;
            d.zodiac.constellations = v ? { figures: 'zodiac', align: 'sign' } : false;
          }, { label: 'constellations' }),
      ),
    );
    if (z.constellations !== undefined && z.constellations !== false) {
      const c = z.constellations;
      host.appendChild(
        row(
          'Drawn',
          select(
            [
              { value: 'sign', label: 'in the arc of its own sign' },
              { value: 'sky', label: 'at the stars’ own longitudes' },
            ],
            c.align ?? 'sign',
            (v) =>
              state.edit((d) => {
                if (d.zodiac !== false && d.zodiac.constellations) d.zodiac.constellations.align = v as 'sign' | 'sky';
              }, { label: 'constellation align' }),
          ),
          'The first is the ring as an emblem — here is Leo, and this is the lion. The second is the truth about where those stars actually are, which is most of a sign away.',
        ),
      );
    }
  }

  /* ---- the palette ---- */
  host.appendChild(el('h4', { class: 'cdx-group', text: 'Ink and faces' }));
  for (const [key, help] of THEME_COLORS) {
    host.appendChild(
      row(
        key,
        colorInput(doc.theme[key] as string, (v) =>
          state.edit((d) => {
            (d.theme as unknown as Record<string, string>)[key] = v;
          }, { label: `theme ${key}`, coalesce: `doc:theme:${key}` }),
        ),
        help,
      ),
    );
  }
  for (const key of ['font', 'activeFont', 'subFont', 'noteFont'] as const) {
    const face = doc.theme[key];
    host.appendChild(
      row(
        key,
        el('div', { class: 'cdx-pair' },
          el('input', {
            type: 'text',
            class: 'cdx-grow',
            value: face.css,
            spellcheck: 'false',
            oninput: (e: Event) =>
              state.edit((d) => {
                d.theme[key] = { css: (e.target as HTMLInputElement).value, px: face.px };
              }, { label: `theme ${key}`, coalesce: `doc:face:${key}` }),
          }),
          numberInput(face.px, 0.5, (px) =>
            state.edit((d) => {
              d.theme[key] = { css: face.css, px };
            }, { label: `theme ${key}`, coalesce: `doc:facepx:${key}` }),
          ),
        ),
      ),
    );
  }
}

const THEME_COLORS: [keyof ThemeDoc & string, string][] = [
  ['ink', 'names, at full strength'],
  ['dim', 'second lines and anything subordinate'],
  ['halo', 'stroked behind text so it reads over anything busy'],
  ['ring', 'a sphere’s rim, when it sets no colour of its own'],
  ['body', 'a carried body, likewise'],
  ['centerMark', 'the cross at a circle’s own centre'],
  ['angle', 'arcs'],
  ['connector', 'lines and sightlines'],
  ['trail', 'trails'],
];

/* -------------------------------------------------------------------------
 * Rows
 * ---------------------------------------------------------------------- */

function row(label: string, control: HTMLElement | null, help?: string): HTMLElement {
  return el('div', { class: 'cdx-field' },
    el('div', { class: 'cdx-fhead' }, el('span', { class: 'cdx-fname', text: label, title: help ?? label })),
    el('div', { class: 'cdx-fcontrol' }, control),
    help ? el('p', { class: 'cdx-help', text: help }) : null,
  );
}

function textRow(label: string, value: string, help: string, onInput: (v: string) => void): HTMLElement {
  return row(label, el('input', { type: 'text', value, oninput: (e: Event) => onInput((e.target as HTMLInputElement).value) }), help);
}

function proseRow(label: string, value: string, help: string, onInput: (v: string) => void): HTMLElement {
  return row(label, el('textarea', { rows: 3, text: value, oninput: (e: Event) => onInput((e.target as HTMLTextAreaElement).value) }), help);
}

function checkRow(label: string, value: boolean, help: string, onChange: (v: boolean) => void): HTMLElement {
  return row(
    label,
    el('label', { class: 'cdx-check' },
      el('input', { type: 'checkbox', ...(value ? { checked: true } : {}), onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
      el('span', { text: value ? 'yes' : 'no' }),
    ),
    help,
  );
}

function numberInput(value: number, step: number, onInput: (n: number) => void): HTMLElement {
  return el('input', {
    type: 'number',
    value,
    step,
    oninput: (e: Event) => {
      const raw = (e.target as HTMLInputElement).value;
      if (raw !== '') onInput(Number(raw));
    },
  });
}

function colorInput(value: string, onInput: (v: string) => void): HTMLElement {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#9fb3d9';
  return el('div', { class: 'cdx-color' },
    el('input', { type: 'color', value: hex, oninput: (e: Event) => onInput((e.target as HTMLInputElement).value) }),
    el('input', { type: 'text', value, spellcheck: 'false', oninput: (e: Event) => onInput((e.target as HTMLInputElement).value) }),
  );
}

function paramRow(p: ParamDoc, index: number, state: EditorState): HTMLElement {
  const edit = (fn: (param: ParamDoc) => void, label: string, coalesce?: string): void =>
    state.edit(
      (d) => {
        const target = d.params[index];
        if (!target) return false;
        fn(target);
      },
      { label, ...(coalesce !== undefined ? { coalesce } : {}) },
    );

  return el('div', { class: 'cdx-param' },
    el('div', { class: 'cdx-pair' },
      el('input', {
        type: 'text',
        class: 'cdx-grow',
        value: p.key,
        title: 'The key expressions read — f.' + p.key,
        spellcheck: 'false',
        oninput: (e: Event) => edit((t) => { t.key = (e.target as HTMLInputElement).value; }, 'parameter key', `param:${index}:key`),
      }),
      el('button', {
        class: 'cdx-clear',
        type: 'button',
        title: 'Remove this parameter',
        text: '⌫',
        onclick: () =>
          state.edit((d) => {
            d.params.splice(index, 1);
          }, { label: 'remove parameter' }),
      }),
    ),
    el('input', {
      type: 'text',
      value: p.label ?? '',
      placeholder: 'what the slider is called',
      oninput: (e: Event) => edit((t) => { t.label = (e.target as HTMLInputElement).value; }, 'parameter label', `param:${index}:label`),
    }),
    el('div', { class: 'cdx-pair' },
      labelled('min', numberInput(p.min ?? 0, 0.1, (n) => edit((t) => { t.min = n; }, 'parameter min', `param:${index}:min`))),
      labelled('max', numberInput(p.max ?? 1, 0.1, (n) => edit((t) => { t.max = n; }, 'parameter max', `param:${index}:max`))),
      labelled('step', numberInput(p.step ?? 0.01, 0.01, (n) => edit((t) => { t.step = n; }, 'parameter step', `param:${index}:step`))),
      labelled('starts at', numberInput(p.value, 0.05, (n) => edit((t) => { t.value = n; }, 'parameter default', `param:${index}:value`))),
    ),
  );
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'cdx-sub' }, el('span', { text: label }), control);
}

function uniqueKey(doc: DiagramDoc): string {
  const taken = new Set(doc.params.map((p) => p.key));
  for (let i = 1; ; i++) {
    const key = i === 1 ? 'amount' : `amount${i}`;
    if (!taken.has(key)) return key;
  }
}
