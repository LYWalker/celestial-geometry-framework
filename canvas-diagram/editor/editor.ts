/**
 * The editor: a live figure you can click, drag and describe.
 *
 * The layout is three columns over one strip, and each part answers one
 * question. The list on the left: what is in this figure. The canvas in the
 * middle: what does it look like, right now, at this moment of its clock and
 * with its sliders where they are. The panel on the right: what exactly is
 * this thing I have selected. The strip below: what is wrong, if anything.
 *
 * Everything in it is a function of `EditorState`. There is no second copy of
 * the figure anywhere, no cached DOM that has to be kept in step — an edit
 * replaces the document, the document recompiles, and every panel rebuilds
 * from what it now says. The only thing that persists across a rebuild is the
 * caret in whatever text field you were typing in, which the inspector
 * restores itself.
 *
 * Drawing is the exception, and deliberately so: the canvas redraws on an
 * animation frame, not on an edit, because a figure with a running clock is
 * redrawing anyway. An edit does not request a draw; the draw loop simply
 * always shows the current state.
 */

import { panBy, worldToScreen, zoomAt } from '../camera.js';
import type { Vec } from '../geometry.js';
import { HoverController } from '../hover.js';
import { Stage, WHEEL_ZOOM_SENSITIVITY, wireResize } from '../scene/stage.js';
import { resolvePoint, type Frame } from '../scene/types.js';
import { emitDocument, type EmitOptions } from './emit.js';
import { clear, el, select } from './dom.js';
import {
  emptyDoc,
  OBJECT_KINDS,
  parseDoc,
  POSITIONED_KINDS,
  type DiagramDoc,
  type ObjectDoc,
  type ObjectKind,
} from './doc.js';
import { renderFigurePanel } from './figure.js';
import { KIND_LABELS, KIND_NOTES } from './fields.js';
import { HANDLE_GRAB_PX, HANDLE_SIZE_PX, handlesFor, type Handle } from './handles.js';
import { renderInspector } from './inspector.js';
import { EDITOR_CSS } from './styles.js';
import { EditorState } from './state.js';
import type { Helpers } from './expr.js';

export interface EditorOptions {
  /** the figure to open with. A new, nearly-empty one when omitted. */
  doc?: DiagramDoc;
  /**
   * Figures offered in the Open menu — the worked examples, and anything the
   * host wants to hand its authors as a starting point.
   */
  examples?: { name: string; doc: () => DiagramDoc }[];
  /**
   * Names the figure's expressions may use, beyond the built-in geometry. This
   * is how a project's own domain functions reach the editor: pass
   * `{ rambam }`, and `{ expr: 'rambam.sun(f.t).mean' }` works here and emits
   * as the same call.
   */
  helpers?: Helpers;
  /** passed to the emitter — where the kit is imported from in emitted code */
  emit?: EmitOptions;
  /** called after every edit, for a host that wants to persist the document */
  onChange?: (doc: DiagramDoc) => void;
}

export interface EditorHandle {
  state: EditorState;
  /** the current document, for a host that wants to save it */
  doc(): DiagramDoc;
  destroy(): void;
}

/** Mount the editor into `host`, which it takes over entirely. */
export function mountEditor(host: HTMLElement, opts: EditorOptions = {}): EditorHandle {
  injectStyles();

  const state = new EditorState(opts.doc ?? emptyDoc());
  if (opts.helpers) state.env.registerHelpers(opts.helpers);

  /* ---- skeleton ------------------------------------------------------- */
  host.classList.add('cdx');
  clear(host);

  const toolbar = el('div', { class: 'cdx-toolbar' });
  const listPanel = el('aside', { class: 'cdx-list' });
  const canvas = el('canvas', { class: 'cdx-canvas' });
  const stageEl = el('div', { class: 'cdx-stage', tabindex: '0' }, canvas);
  const tipEl = el('div', { class: 'cdx-tip', hidden: true });
  const tipText = el('span', {});
  const tipSub = el('span', { class: 'sub' });
  tipEl.append(tipText, tipSub);
  stageEl.appendChild(tipEl);
  const hintEl = el('div', { class: 'cdx-hint' });
  stageEl.appendChild(hintEl);
  const controlsEl = el('div', { class: 'cdx-controls' });
  const panelTabs = el('div', { class: 'cdx-tabs' });
  const panelBody = el('div', { class: 'cdx-panel-body' });
  const inspectorPanel = el('aside', { class: 'cdx-panel' }, panelTabs, panelBody);
  const problemsEl = el('div', { class: 'cdx-problems' });
  const drawer = el('div', { class: 'cdx-drawer', hidden: true });

  host.append(
    toolbar,
    el('div', { class: 'cdx-body' }, listPanel, el('div', { class: 'cdx-center' }, stageEl, controlsEl), inspectorPanel),
    problemsEl,
    drawer,
  );

  /* ---- stage ---------------------------------------------------------- */
  const hover = new HoverController({ root: tipEl, text: tipText, sub: tipSub });
  const stage = new Stage({ canvas, background: state.fig.background, zodiac: state.fig.zodiac });

  let pointer: Vec | null = null;
  let panel: 'object' | 'figure' = 'object';
  let placing: ObjectKind | null = null;
  let dragging: Handle | null = null;
  let panning: { x: number; y: number } | null = null;
  let hotHandle: Handle | null = null;
  let lastTick = performance.now();
  /** the compiled figure the stage was last configured for — the background
   * and ring are Stage's, not Scene's, so they are pushed across on the edits
   * that change them rather than every frame */
  let stagedFor = state.fig;

  function refPoint(): Vec {
    return resolvePoint(state.fig.ref, state.frame());
  }

  /** Canvas-local screen point to world space — the inverse of
   * `worldToScreen`, which every click and drag has to go through. */
  function worldAt(p: Vec): Vec {
    const ref = refPoint();
    const cam = stage.camera;
    return {
      x: (p.x - cam.cx - cam.pan.x) / cam.zoom + ref.x,
      y: (p.y - cam.cy - cam.pan.y) / cam.zoom + ref.y,
    };
  }

  function screenAt(world: Vec): Vec {
    return worldToScreen(world, refPoint(), stage.camera);
  }

  function resize(): void {
    const f = state.frame();
    const fit =
      state.doc.view.fitRadius === 'auto'
        ? (stage.zodiacGeometry(f, state.fig.scene)?.outer ?? state.fig.scene.extent(f) ?? 100) + 12
        : state.doc.view.fitRadius;
    stage.resize({ fitRadius: Math.max(20, fit) });
  }

  /* ---- drawing -------------------------------------------------------- */

  function draw(): void {
    if (stagedFor !== state.fig) {
      // A new compile may have changed the sky or the ring; both live on the
      // Stage rather than in the Scene, so they are the one thing an edit has
      // to push across by hand.
      stage.setBackground(state.fig.background);
      stage.setZodiac(state.fig.zodiac);
      stagedFor = state.fig;
      resize();
    }

    const f = state.frame();
    stage.render({
      scene: state.fig.scene,
      f,
      ref: state.fig.ref,
      theme: state.fig.theme,
      hover,
      pointer,
      ...(state.fig.light !== undefined ? { lightSource: state.fig.light } : {}),
    });

    drawOverlay(f);
  }

  /** The editor's own marks, over the figure: what is selected, and what can
   * be dragged. Screen space, after Stage has finished — these are chrome,
   * not part of the figure, and they must not zoom with it. */
  function drawOverlay(f: Frame): void {
    const ctx = stage.ctx;
    const selected = state.selected();
    hotHandle = null;

    if (!selected) {
      // Still say what a click will do: "add a sphere, then click to place it"
      // is exactly the moment when nothing is selected yet, so the prompt has
      // to survive there or it is missing when it is most needed.
      updateHint();
      return;
    }

    const item = state.fig.items.get(selected.id);
    if (item && 'position' in item) {
      const p = screenAt((item as { position: (f: Frame) => Vec }).position(f));
      ctx.save();
      ctx.strokeStyle = 'rgba(143,214,201,0.9)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const handles = dragging ? [dragging] : handlesFor(selected, state.fig, f);
    for (const h of handles) {
      const p = screenAt(h.at);
      const hot = pointer !== null && Math.hypot(pointer.x - p.x, pointer.y - p.y) <= HANDLE_GRAB_PX;
      if (hot && hotHandle === null) hotHandle = h;
      ctx.save();
      ctx.fillStyle = hot ? '#8fd6c9' : 'rgba(7,11,22,0.85)';
      ctx.strokeStyle = '#8fd6c9';
      ctx.lineWidth = 1.4;
      const r = HANDLE_SIZE_PX + (hot ? 1.5 : 0);
      ctx.beginPath();
      if (h.shape === 'round') ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      else if (h.shape === 'square') ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
      else {
        ctx.moveTo(p.x, p.y - r * 1.3);
        ctx.lineTo(p.x + r * 1.3, p.y);
        ctx.lineTo(p.x, p.y + r * 1.3);
        ctx.lineTo(p.x - r * 1.3, p.y);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    updateHint();
  }

  /** The line along the bottom of the figure: what is about to be placed, or
   * what the handle under the pointer would do. */
  function updateHint(): void {
    hintEl.textContent =
      placing !== null
        ? `${KIND_NOTES[placing]} Click in the figure to place it — on an object to attach it, or anywhere for a fixed point. Esc to stop.`
        : (hotHandle?.label ?? '');
    hintEl.classList.toggle('is-on', placing !== null || hotHandle !== null);
    stageEl.style.cursor = placing !== null ? 'crosshair' : hotHandle !== null ? 'grab' : 'default';
  }

  /**
   * The handle under a screen point, recomputed now.
   *
   * `hotHandle` is what the last drawn frame found under the pointer, which is
   * right for highlighting and wrong for grabbing: a press that arrives before
   * any frame has been drawn with the pointer in its new place — a quick
   * click-drag, a tap, anything synthetic — would find nothing there and pan
   * the camera instead of moving the thing under the finger. So a press asks
   * again, from the state as it stands, rather than trusting a frame that may
   * not have happened yet.
   */
  function handleAt(screen: Vec): Handle | null {
    const selected = state.selected();
    if (!selected) return null;
    const f = state.frame();
    for (const h of handlesFor(selected, state.fig, f)) {
      const p = screenAt(h.at);
      if (Math.hypot(screen.x - p.x, screen.y - p.y) <= HANDLE_GRAB_PX) return h;
    }
    return null;
  }

  let raf = 0;
  function loop(now: number): void {
    raf = requestAnimationFrame(loop);
    if (state.playing) {
      state.t += ((now - lastTick) / 1000) * state.doc.clock.speed;
      renderClockReadout();
    }
    lastTick = now;
    draw();
  }

  /* ---- pointer -------------------------------------------------------- */

  const localPoint = (e: PointerEvent | WheelEvent): Vec => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    stageEl.focus({ preventScroll: true });
    const p = localPoint(e);
    pointer = p;

    if (placing !== null) {
      place(placing, p);
      placing = null;
      return;
    }

    const grabbed = handleAt(p);
    if (grabbed) {
      dragging = grabbed;
      hotHandle = grabbed;
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Not on a handle: this is either a click on something (select it) or the
    // start of a pan. Which one it turns out to be is decided on pointerup, by
    // whether it moved — the same rule wireCamera uses, so the two figures
    // behave alike under the same gesture.
    panning = { x: p.x, y: p.y };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const p = localPoint(e);
    pointer = p;
    if (dragging) {
      dragging.drag(worldAt(p), state);
      return;
    }
    if (panning && e.buttons > 0) {
      panBy(stage.camera, e.movementX, e.movementY);
    }
  });

  const endGesture = (e: PointerEvent): void => {
    const p = localPoint(e);
    if (dragging) {
      dragging = null;
      state.breakCoalesce();
    } else if (panning && Math.hypot(p.x - panning.x, p.y - panning.y) < 4) {
      // it never really moved: a click
      const hit = state.fig.scene.hitTest(p, { f: state.frame(), ref: state.fig.ref, camera: stage.camera });
      state.select(hit ? hit.id : null);
      if (hit) panel = 'object';
      renderAll();
    }
    panning = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
  });

  canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const p = localPoint(e);
      zoomAt(
        stage.camera,
        p.x - stage.camera.cx,
        p.y - stage.camera.cy,
        Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY),
        stage.fit * 0.2,
        stage.fit * 40,
      );
    },
    { passive: false },
  );

  stageEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      placing = null;
      state.select(null);
      renderAll();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId !== null) {
      e.preventDefault();
      removeSelected();
    } else if (e.key === '0') {
      stage.camera.pan = { x: 0, y: 0 };
      resize();
    }
  });

  host.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      state.undo();
      renderAll();
    } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      state.redo();
      renderAll();
    }
  });

  /* ---- adding and removing -------------------------------------------- */

  /**
   * Put a new object where the pointer went down, attached to whatever was
   * under it.
   *
   * Clicking on an existing object attaches to it by reference rather than
   * copying its coordinates, which is the difference between a figure that
   * holds together when something moves and one that comes apart. Clicking on
   * empty space gives a fixed point instead, since there is nothing to attach
   * to and a loose point is what was asked for.
   */
  function place(kind: ObjectKind, screen: Vec): void {
    const hit = state.fig.scene.hitTest(screen, { f: state.frame(), ref: state.fig.ref, camera: stage.camera });
    const attachable = hit !== null && POSITIONED_KINDS.includes(hit.kind as ObjectKind) ? hit.id : null;
    const world = worldAt(screen);
    const anchor = attachable !== null ? { ref: attachable } : { x: round(world.x), y: round(world.y) };
    const id = uniqueId(state.doc, kind);
    const obj = newObject(kind, id, anchor, world);
    state.edit((d) => {
      d.objects.push(obj);
    }, { label: `add ${kind}` });
    state.select(id);
    panel = 'object';
    renderAll();
  }

  function removeSelected(): void {
    const id = state.selectedId;
    if (id === null) return;
    const dependants = state.doc.objects.filter(
      (o) => o.id !== id && JSON.stringify(o).includes(`"ref":"${id}"`),
    );
    if (dependants.length > 0) {
      const names = dependants.map((o) => o.name).join(', ');
      if (!confirm(`${names} ${dependants.length === 1 ? 'refers' : 'refer'} to this. Remove it anyway? They will lose their reference.`)) {
        return;
      }
    }
    state.edit((d) => {
      d.objects = d.objects.filter((o) => o.id !== id);
    }, { label: 'remove' });
    state.select(null);
    renderAll();
  }

  function duplicateSelected(): void {
    const o = state.selected();
    if (!o) return;
    const copy = structuredClone(o);
    copy.id = uniqueId(state.doc, o.kind);
    copy.name = `${o.name} (copy)`;
    state.edit((d) => {
      d.objects.push(copy);
    }, { label: 'duplicate' });
    state.select(copy.id);
    renderAll();
  }

  /* ---- panels --------------------------------------------------------- */

  function renderToolbar(): void {
    clear(toolbar);
    toolbar.append(
      el('input', {
        class: 'cdx-title',
        type: 'text',
        value: state.doc.name,
        title: 'What this figure is called',
        oninput: (e: Event) =>
          state.edit((d) => {
            d.name = (e.target as HTMLInputElement).value;
          }, { label: 'name', coalesce: 'doc:name' }),
      }),
      el('span', { class: 'cdx-spacer' }),
      select(
        [{ value: '', label: '+ add…' }, ...OBJECT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))],
        '',
        (v) => {
          if (v === '') return;
          placing = v as ObjectKind;
          stageEl.focus({ preventScroll: true });
          renderToolbar();
        },
        { class: 'cdx-add-menu', title: 'Add an object, then click in the figure to place it' },
      ),
      el('button', { type: 'button', text: 'Duplicate', disabled: state.selectedId === null, onclick: duplicateSelected }),
      el('button', { type: 'button', text: 'Remove', disabled: state.selectedId === null, onclick: removeSelected }),
      el('span', { class: 'cdx-spacer' }),
      el('button', { type: 'button', text: '↶', title: 'Undo (Ctrl+Z)', disabled: !state.canUndo(), onclick: () => { state.undo(); renderAll(); } }),
      el('button', { type: 'button', text: '↷', title: 'Redo (Ctrl+Shift+Z)', disabled: !state.canRedo(), onclick: () => { state.redo(); renderAll(); } }),
      el('span', { class: 'cdx-spacer' }),
      el('button', { type: 'button', text: 'Code', title: 'The TypeScript this figure emits as', onclick: () => showCode() }),
      el('button', { type: 'button', text: 'JSON', title: 'Save or load this figure as a document', onclick: () => showJson() }),
      ...(opts.examples && opts.examples.length > 0
        ? [select(
            [{ value: '', label: 'Open…' }, ...opts.examples.map((x, i) => ({ value: String(i), label: x.name }))],
            '',
            (v) => {
              if (v === '') return;
              const chosen = opts.examples?.[Number(v)];
              if (chosen) {
                state.load(chosen.doc(), 'open');
                renderAll();
              }
            },
          )]
        : []),
      el('button', { type: 'button', text: 'New', onclick: () => { state.load(emptyDoc(), 'new'); renderAll(); } }),
    );
  }

  function renderList(): void {
    clear(listPanel);
    listPanel.appendChild(el('h4', { class: 'cdx-group', text: 'In this figure' }));
    if (state.doc.objects.length === 0) {
      listPanel.appendChild(el('p', { class: 'cdx-empty', text: 'Nothing yet. Add something above, then click in the figure to place it.' }));
    }
    for (const [i, o] of state.doc.objects.entries()) {
      const isSelected = o.id === state.selectedId;
      listPanel.appendChild(
        el('div', { class: `cdx-item${isSelected ? ' is-selected' : ''}`, onclick: () => { state.select(o.id); panel = 'object'; renderAll(); } },
          el('span', { class: `cdx-dot cdx-dot-${o.kind}`, title: KIND_LABELS[o.kind] }),
          el('span', { class: 'cdx-item-name', text: o.name || o.id, title: `${KIND_LABELS[o.kind]} — ${o.id}` }),
          // Draw order is the list's order, so moving a row moves what is
          // drawn over what — which is the only reason a figure's objects have
          // an order at all.
          el('button', { class: 'cdx-move', type: 'button', text: '↑', title: 'Draw earlier', disabled: i === 0, onclick: (e: Event) => { e.stopPropagation(); move(i, -1); } }),
          el('button', { class: 'cdx-move', type: 'button', text: '↓', title: 'Draw later', disabled: i === state.doc.objects.length - 1, onclick: (e: Event) => { e.stopPropagation(); move(i, 1); } }),
        ),
      );
    }
  }

  function move(index: number, by: number): void {
    state.edit((d) => {
      const next = index + by;
      if (next < 0 || next >= d.objects.length) return false;
      const [item] = d.objects.splice(index, 1);
      if (item) d.objects.splice(next, 0, item);
    }, { label: 'reorder' });
    renderAll();
  }

  function renderPanel(): void {
    clear(panelTabs);
    for (const [key, label] of [['object', 'Selected'], ['figure', 'Figure']] as const) {
      panelTabs.appendChild(
        el('button', {
          type: 'button',
          class: panel === key ? 'is-on' : '',
          text: label,
          onclick: () => {
            panel = key;
            renderPanel();
          },
        }),
      );
    }
    if (panel === 'object') renderInspector(panelBody, state);
    else renderFigurePanel(panelBody, state);
  }

  const clockLabel = el('span', { class: 'cdx-clocklabel' });
  const clockRange = el('input', { type: 'range', class: 'cdx-scrub' });

  function renderControls(): void {
    clear(controlsEl);
    const playBtn = el('button', {
      type: 'button',
      class: 'cdx-play',
      text: state.playing ? '❚❚' : '▶',
      title: state.playing ? 'Pause the clock' : 'Run the clock',
      onclick: () => {
        state.setPlaying(!state.playing);
        renderControls();
      },
    });
    clockRange.min = '0';
    clockRange.max = String(state.doc.clock.scrub ?? 400);
    clockRange.step = String(Math.max(0.001, (state.doc.clock.scrub ?? 400) / 2000));
    clockRange.value = String(state.t);
    clockRange.oninput = () => {
      state.setPlaying(false);
      state.setClock(Number(clockRange.value));
      renderControls();
    };
    controlsEl.append(playBtn, clockRange, clockLabel);
    renderClockReadout();

    for (const p of state.doc.params) {
      const input = el('input', {
        type: 'range',
        min: p.min ?? 0,
        max: p.max ?? 1,
        step: p.step ?? 0.01,
        value: state.params[p.key] ?? p.value,
        oninput: (e: Event) => {
          state.setParam(p.key, Number((e.target as HTMLInputElement).value));
          readout.textContent = String(state.params[p.key]);
        },
      });
      const readout = el('span', { class: 'cdx-pval', text: String(state.params[p.key] ?? p.value) });
      controlsEl.appendChild(
        el('label', { class: 'cdx-ctl', title: p.description ?? `read as f.${p.key}` },
          el('span', { text: p.label ?? p.key }),
          input,
          readout,
        ),
      );
    }
  }

  function renderClockReadout(): void {
    clockLabel.textContent = `${state.t.toFixed(1)}${state.doc.clock.unit ? ` ${state.doc.clock.unit}` : ''}`;
    if (!clockRange.matches(':active')) clockRange.value = String(state.t);
  }

  function renderProblems(): void {
    clear(problemsEl);
    const structural = state.fig.problems;
    const expressions = state.fig.env.allProblems();
    const all = [
      ...structural.map((p) => ({ where: [p.id, p.field].filter(Boolean).join(' · '), message: p.message })),
      ...expressions.map((p) => ({ where: `${p.id} · ${p.field}`, message: p.message })),
    ];
    problemsEl.classList.toggle('is-on', all.length > 0);
    if (all.length === 0) return;
    // One row per distinct message: a runtime failure in a Scalar read by
    // three objects is one mistake, and listing it three times would bury
    // whatever else is wrong.
    const seen = new Set<string>();
    for (const p of all) {
      const key = `${p.where}|${p.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problemsEl.appendChild(
        el('div', { class: 'cdx-problem' }, p.where ? el('code', { text: p.where }) : null, el('span', { text: p.message })),
      );
    }
  }

  function renderAll(): void {
    renderToolbar();
    renderList();
    renderPanel();
    renderControls();
    renderProblems();
  }

  /* ---- drawers -------------------------------------------------------- */

  function showDrawer(title: string, body: HTMLElement, actions: HTMLElement[]): void {
    clear(drawer);
    drawer.hidden = false;
    drawer.append(
      el('div', { class: 'cdx-drawer-head' },
        el('strong', { text: title }),
        el('span', { class: 'cdx-spacer' }),
        ...actions,
        el('button', { type: 'button', text: 'Close', onclick: () => { drawer.hidden = true; } }),
      ),
      body,
    );
  }

  function showCode(): void {
    const emitted = emitDocument(state.doc, opts.emit ?? {});
    const area = el('textarea', { class: 'cdx-code', spellcheck: 'false', readonly: true, text: emitted.code });
    showDrawer(emitted.filename, area, [
      el('button', { type: 'button', text: 'Copy', onclick: () => { void navigator.clipboard?.writeText(emitted.code); } }),
      el('button', {
        type: 'button',
        text: 'Download',
        onclick: () => download(emitted.filename, emitted.code, 'text/plain'),
      }),
    ]);
  }

  function showJson(): void {
    const area = el('textarea', { class: 'cdx-code', spellcheck: 'false', text: state.toJSON() });
    const status = el('span', { class: 'cdx-status' });
    showDrawer('figure.json', el('div', { class: 'cdx-drawer-body' }, area, status), [
      el('button', { type: 'button', text: 'Copy', onclick: () => { void navigator.clipboard?.writeText(area.value); } }),
      el('button', {
        type: 'button',
        text: 'Download',
        onclick: () => download(`${slug(state.doc.name)}.json`, area.value, 'application/json'),
      }),
      el('button', {
        type: 'button',
        text: 'Load this',
        onclick: () => {
          const result = parseDoc(area.value);
          if ('error' in result) {
            status.textContent = result.error;
            return;
          }
          state.load(result.doc, 'load JSON');
          renderAll();
          drawer.hidden = true;
        },
      }),
    ]);
  }

  /* ---- go ------------------------------------------------------------- */

  const unsubscribe = state.subscribe((reason) => {
    if (reason === 'doc') {
      renderAll();
      opts.onChange?.(state.doc);
    }
  });

  renderAll();
  const unwireResize = wireResize(stageEl, resize);
  raf = requestAnimationFrame(loop);

  return {
    state,
    doc: () => state.doc,
    destroy(): void {
      cancelAnimationFrame(raf);
      unsubscribe();
      unwireResize();
      stage.destroy();
      clear(host);
      host.classList.remove('cdx');
    },
  };
}

/* -------------------------------------------------------------------------
 * New objects
 * ---------------------------------------------------------------------- */

/**
 * A newly placed object, already sensible.
 *
 * The defaults matter more here than they look. An object that appears as
 * nothing — a sphere of radius zero, a connector with no end — teaches you
 * only that the button did something. Each of these arrives visible, named,
 * and attached to whatever it was dropped on, so the next thing you do is
 * adjust it rather than assemble it.
 */
function newObject(
  kind: ObjectKind,
  id: string,
  anchor: { ref: string } | { x: number; y: number },
  world: Vec,
): ObjectDoc {
  // The name takes its number from the id rather than counting what is already
  // there, so a new object is never called "Sphere 3" while its id is
  // `sphere-1` — two numbers for one thing, disagreeing at first sight.
  const name = `${KIND_LABELS[kind]} ${id.slice(kind.length + 1)}`;
  // How far the click was from the origin: a reasonable size for something
  // dropped there, so a sphere placed out near the ring is not born tiny.
  const reach = Math.max(30, Math.round(Math.hypot(world.x, world.y)));

  switch (kind) {
    case 'anchor':
      return { kind, id, name, marker: 'cross', ...('ref' in anchor ? { at: anchor } : { at: anchor }) };
    case 'sphere':
      return { kind, id, name, center: anchor, radius: reach, speed: 30, markCenter: false };
    case 'connector':
      return { kind, id, name, from: anchor, toward: 0, length: reach, dashed: true };
    case 'angle':
      return { kind, id, name, vertex: anchor, from: 0, to: 60, radius: Math.round(reach * 0.4), short: true, showValue: true };
    case 'trail':
      return { kind, id, name, target: anchor, span: 5, step: 0.05, bands: 8 };
    case 'ringmarker':
      return { kind, id, name, center: anchor, radius: reach, toward: 0, style: 'solid' };
  }
}

function uniqueId(doc: DiagramDoc, kind: ObjectKind): string {
  const taken = new Set(doc.objects.map((o) => o.id));
  for (let i = 1; ; i++) {
    const id = `${kind}-${i}`;
    if (!taken.has(id)) return id;
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figure';
}

function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  a.click();
  // Revoking immediately can beat the download in some browsers; a frame is
  // enough and the object is small either way.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/** The stylesheet, added once per document however many editors are mounted. */
function injectStyles(): void {
  if (document.getElementById('cdx-styles')) return;
  const style = document.createElement('style');
  style.id = 'cdx-styles';
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}
