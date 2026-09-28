/**
 * The editor: a live figure you draw, click, drag and describe.
 *
 * The layout is three columns over one strip, and each part answers one
 * question. The list on the left: what is in this figure. The canvas in the
 * middle: what does it look like, right now, at this moment of its clock and
 * with its sliders where they are. The panel on the right: what exactly is
 * this thing I have selected. The strip below: what is wrong, if anything.
 *
 * Building happens on the canvas, with tools, the way a drawing program works:
 * press on the earth and drag out a sphere; drag from one body to another for
 * a line between them; click a vertex and two targets for an angle. Wherever a
 * tool is pressed on a body or a point, it *attaches* — the new object holds a
 * reference to it rather than a copy of its coordinates, so the figure keeps
 * holding together when things move. That one rule (it snaps, and a snap is a
 * reference) is what makes an epicycle a single drag instead of a panel of
 * fields.
 *
 * Everything in it is a function of `EditorState`. There is no second copy of
 * the figure anywhere, no cached DOM that has to be kept in step — an edit
 * replaces the document, the document recompiles, and every panel rebuilds
 * from what it now says.
 *
 * Drawing is the exception, and deliberately so: the canvas redraws on an
 * animation frame, not on an edit, because a figure with a running clock is
 * redrawing anyway.
 *
 * The camera fits a figure when it is opened, and then stays where it is.
 * Re-fitting after every edit sounds helpful and is the opposite: drag a rim
 * outwards, the view zooms out to fit it, the rim slides back under the
 * pointer, and the drag runs away from the hand making it. `F` (or the Fit
 * button) re-fits on request.
 */

import { panBy, worldToScreen, zoomAt } from '../camera.js';
import { lonOf, norm360, polar, sub, type Vec } from '../geometry.js';
import { HoverController } from '../hover.js';
import { Sphere } from '../scene/sphere.js';
import { Stage, WHEEL_ZOOM_SENSITIVITY, wireResize } from '../scene/stage.js';
import { resolvePoint, type Frame } from '../scene/types.js';
import { varName } from './compile.js';
import { emitDocument, type EmitOptions } from './emit.js';
import { formatLongitude } from './units.js';
import { centralSun } from './bodies.js';
import { clear, el, select } from './dom.js';
import {
  emptyDoc,
  idFromName,
  isRef,
  MAZALOT,
  parseDoc,
  POSITIONED_KINDS,
  type DiagramDoc,
  type DirValue,
  type ObjectDoc,
  type ObjectKind,
  type PointValue,
} from './doc.js';
import { renderFigurePanel } from './figure.js';
import { KIND_LABELS } from './fields.js';
import { HANDLE_GRAB_PX, HANDLE_SIZE_PX, handlesFor, type Handle } from './handles.js';
import { renderInspector, type QuickAction } from './inspector.js';
import { EDITOR_CSS } from './styles.js';
import { EditorState, setPath } from './state.js';
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

/* -------------------------------------------------------------------------
 * Tools
 * ---------------------------------------------------------------------- */

type Tool = 'select' | ObjectKind;

interface ToolSpec {
  tool: Tool;
  key: string;
  icon: string;
  label: string;
  /** what to do next, one line per step of the gesture */
  steps: string[];
}

const TOOLS: ToolSpec[] = [
  { tool: 'select', key: 'v', icon: '↖', label: 'Select', steps: [''] },
  {
    tool: 'sphere',
    key: 's',
    icon: '◯',
    label: 'Sphere',
    steps: [
      'Press on what it is centred on — the earth, a body (for an epicycle), or another sphere’s centre.',
      'Drag or click out the radius. It snaps to bodies and to spheres sharing its centre; type the exact value after.',
    ],
  },
  {
    tool: 'connector',
    key: 'l',
    icon: '╱',
    label: 'Line',
    steps: [
      'Press on where the line starts — a body, a point, or a sphere’s centre.',
      'End on another object to join them, or on the mazalot ring for a sightline toward that longitude.',
    ],
  },
  {
    tool: 'angle',
    key: 'a',
    icon: '∠',
    label: 'Angle',
    steps: [
      'Click the vertex — where the angle is seen from.',
      'Click what the first arm points at — an object, or a longitude on the ring.',
      'Click what the second arm points at.',
    ],
  },
  {
    tool: 'anchor',
    key: 'p',
    icon: '✛',
    label: 'Point',
    steps: ['Click a body, a sphere’s centre, or a longitude on the ring, to name that place.'],
  },
  { tool: 'trail', key: 't', icon: '⋰', label: 'Trail', steps: ['Click a body to draw where it has been.'] },
  {
    tool: 'ringmarker',
    key: 'r',
    icon: '⊙',
    label: 'Reading',
    steps: ['Click a body to mark where it is read on the ring.'],
  },
]

/** What a tool press can land on: a body or named point, a sphere's own
 * centre, or a longitude on the mazalot ring. */
type SnapKind = 'object' | 'centre' | 'ring';

/**
 * What a tool press landed on. Never a bare place: everything in these
 * figures is where it is *because of* something else — centred on the earth,
 * riding a sphere, pointing at a degree of a sign — and a point dropped in
 * empty space is a coordinate nobody can state, which is the one kind of
 * value a precise figure should not have.
 */
interface Snap {
  kind: SnapKind;
  /** the object it belongs to — the body or point itself, or the sphere
   * whose centre it is. Null on the ring. */
  id: string | null;
  world: Vec;
  /** what it is called, on the canvas beside it and in the hint */
  name: string;
  /** on the ring: the longitude, to the whole degree */
  lon?: number;
}

/** A tool gesture in progress — a sphere being dragged out, an angle waiting
 * for its second arm. */
interface Gesture {
  tool: ObjectKind;
  snaps: Snap[];
  /** where the press went down, for the tools that are one drag */
  down: Vec | null;
}

/** A reference field waiting for its target to be clicked. */
interface Pick {
  id: string;
  path: string;
  label: string;
  accepts: 'point' | 'dir';
}

/** The editor's own accent — its marks, over the figure's. */
const ACCENT = '#8fd6c9';

/** How close, in screen px, a tool has to come to attach to something —
 * generous, since attaching is the only thing a tool press can do. */
const SNAP_PX = 18;

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
  let tool: Tool = 'select';
  let gesture: Gesture | null = null;
  let pick: Pick | null = null;
  let dragging: Handle | null = null;
  let panning: { x: number; y: number } | null = null;
  let hotHandle: Handle | null = null;
  /** whether Shift was down at the last pointer event — finer steps */
  let shiftHeld = false;
  /** a one-off message in the hint strip — "that needs a body" */
  let flash: { text: string; until: number } | null = null;
  let lastTick = performance.now();
  /** the compiled figure the stage was last configured for — the background
   * and ring are Stage's, not Scene's, so they are pushed across on the edits
   * that change them rather than every frame */
  let stagedFor = state.fig;
  /** the world radius the camera is fitted to, measured when a figure is
   * opened (or on request) and then held, so edits never move the view */
  let fitRadius = 150;
  /** re-fit on the next frame, once the Stage has the ring an edit just added */
  let refitNext = false;
  /** which load the camera was last fitted for — see `state.loads` */
  let fittedFor = -1;

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

  /** How much of the world the figure as it stands wants to show. A floor
   * under it, so a new figure that is only an earth opens at a scale where
   * the first sphere drawn has room, not zoomed in on a point. */
  function measureFit(): number {
    if (state.doc.view.fitRadius !== 'auto') return state.doc.view.fitRadius;
    const f = state.frame();
    const reach = stage.zodiacGeometry(f, state.fig.scene)?.outer ?? state.fig.scene.extent(f);
    return Math.max(140, reach + 12);
  }

  /** The canvas changed size: keep the same view of the world in it. */
  function resize(): void {
    stage.resize({ fitRadius });
  }

  /** Fit the camera to the figure, from scratch. Returns whether the canvas
   * had a size to fit into yet. */
  function refit(): boolean {
    fitRadius = measureFit();
    stage.camera.pan = { x: 0, y: 0 };
    if (!stage.resize({ fitRadius })) return false;
    stage.camera.zoom = stage.fit;
    return true;
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
    }
    if (fittedFor !== state.loads && refit()) fittedFor = state.loads;
    if (refitNext && refit()) refitNext = false;

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

  /** The editor's own marks, over the figure: what is selected, what can be
   * dragged, and what a tool is about to make. Screen space, after Stage has
   * finished — these are chrome, not part of the figure, and they must not
   * zoom with it. */
  function drawOverlay(f: Frame): void {
    const ctx = stage.ctx;
    hotHandle = null;

    if (tool !== 'select' || pick !== null) {
      drawToolPreview(ctx);
      updateHint();
      return;
    }

    const selected = state.selected();
    if (!selected) {
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

  /** What the active tool would do if the pointer went down here: a halo and
   * a name on whatever it would attach to, a rubber band of the thing
   * half-made — or, where there is nothing to attach to, a mark that says so. */
  function drawToolPreview(ctx: CanvasRenderingContext2D): void {
    if (!pointer) return;
    const snap = snapAt(pointer);
    const end = snap ? screenAt(snap.world) : pointer;

    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.3;

    const first = gesture?.snaps[0];
    if (gesture && first) {
      const a = screenAt(first.world);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (gesture.tool === 'sphere') {
        const r = sphereRadius(first, pointer);
        ctx.arc(a.x, a.y, r.value * stage.camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        chip(ctx, pointer, `radius ${fmt(r.value)}${r.why ? ` — ${r.why}` : ''}`);
      } else {
        const b = gesture.tool === 'connector' || gesture.tool === 'angle' ? end : pointer;
        for (const s of gesture.snaps.slice(1)) {
          const c = screenAt(s.world);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(c.x, c.y);
        }
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const s of gesture.snaps) dot(ctx, screenAt(s.world), 3.5);
    }

    const radiusFree = gesture?.tool === 'sphere';
    if (snap && !radiusFree) {
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(143,214,201,0.2)';
      ctx.beginPath();
      ctx.arc(end.x, end.y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 15, 0, Math.PI * 2);
      ctx.stroke();
      dot(ctx, end, 3.5);
      chip(ctx, end, snap.name);
    } else if (!snap && !radiusFree) {
      // nothing to attach to: a small muted cross where a press would do nothing
      ctx.strokeStyle = 'rgba(150,160,189,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(pointer.x - 4, pointer.y - 4);
      ctx.lineTo(pointer.x + 4, pointer.y + 4);
      ctx.moveTo(pointer.x + 4, pointer.y - 4);
      ctx.lineTo(pointer.x - 4, pointer.y + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function dot(ctx: CanvasRenderingContext2D, p: Vec, r: number): void {
    ctx.beginPath();
    ctx.fillStyle = ACCENT;
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** A name on a dark tab beside a point — what a press here would attach to. */
  function chip(ctx: CanvasRenderingContext2D, at: Vec, text: string): void {
    ctx.save();
    ctx.font = '600 11.5px "Inter Variable", Inter, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 14;
    const h = 20;
    const x = Math.min(Math.max(4, at.x + 18), stage.w - w - 4);
    const y = Math.min(Math.max(4, at.y - 32), stage.h - h - 4);
    ctx.fillStyle = 'rgba(7,11,22,0.94)';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 7, y + h / 2 + 0.5);
    ctx.restore();
  }

  /** The line along the bottom of the figure: what to do next, or what the
   * handle under the pointer does. */
  function updateHint(): void {
    let text = '';
    if (flash && performance.now() < flash.until) text = flash.text;
    else if (pick !== null) {
      text = `Click the object for “${pick.label}”${pick.accepts === 'dir' ? ', or a longitude on the ring' : ', or a sphere’s centre'}. Esc to cancel.`;
    } else if (tool !== 'select') {
      const spec = TOOLS.find((t) => t.tool === tool);
      const step = gesture ? gesture.snaps.length : 0;
      text = spec?.steps[Math.min(step, spec.steps.length - 1)] ?? '';
    } else text = hotHandle?.label ? `${hotHandle.label} · Shift for finer steps` : '';

    if (hintEl.textContent !== text) hintEl.textContent = text;
    hintEl.classList.toggle('is-on', text !== '');
    const aiming = tool !== 'select' || pick !== null;
    const onSomething = aiming && pointer !== null && (gesture?.tool === 'sphere' || snapAt(pointer) !== null);
    stageEl.style.cursor = aiming ? (onSomething ? 'crosshair' : 'not-allowed') : hotHandle !== null ? 'grab' : 'default';
  }

  function say(text: string): void {
    flash = { text, until: performance.now() + 3200 };
  }

  /** What the step in hand may land on. */
  function accepts(): readonly SnapKind[] {
    if (pick) return pick.accepts === 'point' ? ['object', 'centre'] : ['object', 'ring'];
    switch (tool) {
      case 'sphere':
        return ['object', 'centre'];
      case 'connector':
        return gesture ? ['object', 'centre', 'ring'] : ['object', 'centre'];
      case 'angle':
        return gesture ? ['object', 'ring'] : ['object', 'centre'];
      case 'anchor':
        return ['object', 'centre', 'ring'];
      case 'trail':
      case 'ringmarker':
        return ['object'];
      default:
        return [];
    }
  }

  /**
   * What a press at this screen point would attach to, or null.
   *
   * Bodies and named points first — only where drawn, since a bare shell's
   * "position" is a point on its rim nobody can see. A sphere's own centre
   * where it is a place in its own right (an eccentric's, not the earth it is
   * centred on, which is already a target). The ring last, as a longitude to
   * the whole degree, so an arm or a sightline can point at 26° of Gemini.
   */
  function snapAt(screen: Vec, kinds: readonly SnapKind[] = accepts()): Snap | null {
    if (kinds.length === 0) return null;
    const f = state.frame();
    let best: Snap | null = null;
    let bestDist = SNAP_PX;
    const offer = (s: Snap): void => {
      if (!Number.isFinite(s.world.x) || !Number.isFinite(s.world.y)) return;
      const p = screenAt(s.world);
      const d = Math.hypot(p.x - screen.x, p.y - screen.y);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    };

    for (const o of state.doc.objects) {
      const item = state.fig.items.get(o.id);
      if (!item) continue;
      if (kinds.includes('object') && POSITIONED_KINDS.includes(o.kind) && 'position' in item) {
        if (!(item instanceof Sphere && !item.showBody)) {
          offer({ kind: 'object', id: o.id, world: (item as { position: (f: Frame) => Vec }).position(f), name: o.name || o.id });
        }
      }
      if (kinds.includes('centre') && item instanceof Sphere && o.kind === 'sphere') {
        if (o.eccentric !== undefined || o.center === undefined || !isRef(o.center)) {
          offer({ kind: 'centre', id: o.id, world: item.centerAt(f), name: `centre of ${inline(o.id)}` });
        }
      }
    }
    if (best !== null) return best;

    if (kinds.includes('ring')) {
      const g = stage.zodiacGeometry(f, state.fig.scene);
      if (g) {
        const w = worldAt(screen);
        const d = dist(g.center, w);
        const slack = 10 / stage.camera.zoom;
        if (d > g.radius - slack && d < g.outer + slack) {
          const lon = Math.round(norm360(lonOf(sub(w, g.center)))) % 360;
          const p = polar(lon, g.radius);
          return {
            kind: 'ring',
            id: null,
            world: { x: g.center.x + p.x, y: g.center.y + p.y },
            name: `${formatLongitude(lon)} on the ring`,
            lon,
          };
        }
      }
    }
    return null;
  }

  /** The same, for an object already known — how a quick action "snaps" to
   * the selection without a pointer. */
  function snapOf(id: string): Snap | null {
    const o = state.doc.objects.find((x) => x.id === id);
    const item = state.fig.items.get(id);
    if (!o || !item || !('position' in item)) return null;
    return { kind: 'object', id, world: (item as { position: (f: Frame) => Vec }).position(state.frame()), name: o.name || id };
  }

  /**
   * The radius a sphere being drawn from `center` would get with the pointer
   * here: through a body or point, if the pointer is on one; the radius of a
   * sphere it shares a centre with, if it is near one — nested shells are the
   * commonest thing in these figures; otherwise the distance, to a whole
   * world px (a tenth with Shift). The exact value is then a field away.
   */
  function sphereRadius(center: Snap, screen: Vec): { value: number; why: string } {
    const through = snapAt(screen, ['object', 'centre']);
    if (through && !(through.kind === center.kind && through.id === center.id)) {
      return { value: round(dist(center.world, through.world)), why: `through ${inline(through.id) || through.name}` };
    }
    const raw = dist(center.world, worldAt(screen));
    const f = state.frame();
    for (const o of state.doc.objects) {
      const item = state.fig.items.get(o.id);
      if (!(item instanceof Sphere)) continue;
      if (dist(item.centerAt(f), center.world) > 1e-6) continue;
      const r = item.radiusAt(f);
      if (Math.abs(r - raw) * stage.camera.zoom < 8) return { value: r, why: `same as ${inline(o.id)}` };
    }
    return { value: shiftHeld ? round(raw) : Math.round(raw), why: '' };
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
    shiftHeld = e.shiftKey;

    // Any button but the first pans, whatever tool is out — so the view can
    // be moved mid-gesture without putting the tool down.
    if (e.button !== 0) {
      panning = { x: p.x, y: p.y };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (pick !== null) {
      const s = snapAt(p);
      if (s) completePick(s);
      else say('Nothing to attach to there — click an object.');
      return;
    }

    if (tool !== 'select') {
      toolDown(tool, p);
      if (gesture?.down) canvas.setPointerCapture(e.pointerId);
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
    shiftHeld = e.shiftKey;
    if (dragging) {
      dragging.drag(worldAt(p), state, e.shiftKey);
      return;
    }
    if (panning && e.buttons > 0) {
      panBy(stage.camera, e.movementX, e.movementY);
    }
  });

  const endGesture = (e: PointerEvent): void => {
    const p = localPoint(e);
    shiftHeld = e.shiftKey;
    if (gesture?.down) {
      const g = gesture;
      const start = g.down as Vec;
      const dragged = Math.hypot(p.x - start.x, p.y - start.y) > 5;
      // A press that did not move is the first of two clicks: the gesture
      // waits for the second, rather than guessing the rest.
      if (!dragged) g.down = null;
      else {
        gesture = null;
        finishGesture(g, p);
      }
    } else if (dragging) {
      dragging = null;
      state.breakCoalesce();
    } else if (panning && e.button === 0 && Math.hypot(p.x - panning.x, p.y - panning.y) < 4) {
      // it never really moved: a click
      const hit = state.fig.scene.hitTest(p, { f: state.frame(), ref: state.fig.ref, camera: stage.camera, shapes: true });
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
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

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

  /** Put a tool down: cancel whatever it was halfway through. */
  function setTool(next: Tool): void {
    tool = next;
    gesture = null;
    pick = null;
    flash = null;
    if (next !== 'select') state.setPlaying(false);
    stageEl.focus({ preventScroll: true });
    renderToolbar();
    renderControls();
  }

  const isTyping = (e: KeyboardEvent): boolean => {
    const t = e.target as HTMLElement | null;
    return t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };

  // Listened for on the document rather than the host: a panel rebuild
  // removes whatever button had focus, which drops focus to <body>, and a
  // shortcut that stops working after you press play is worse than none.
  const onKeyDown = (e: KeyboardEvent): void => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && !host.contains(active)) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) {
        if (isTyping(e)) return; // leave a text field its own undo
        e.preventDefault();
        state.undo();
        renderAll();
      } else if (e.key === 'y' || (e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey)) {
        if (isTyping(e)) return;
        e.preventDefault();
        state.redo();
        renderAll();
      } else if (e.key === 'd' && !isTyping(e)) {
        e.preventDefault();
        duplicateSelected();
      }
      return;
    }
    if (e.altKey || isTyping(e)) return;

    if (e.key === 'Escape') {
      if (gesture || pick || tool !== 'select') setTool('select');
      else {
        state.select(null);
        renderAll();
      }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId !== null) {
      e.preventDefault();
      removeSelected();
      return;
    }
    if (e.key === ' ' && (e.target === stageEl || e.target === document.body)) {
      e.preventDefault();
      state.setPlaying(!state.playing);
      renderControls();
      return;
    }
    if (e.key === 'f' || e.key === '0') {
      refit();
      return;
    }
    const spec = TOOLS.find((t) => t.key === e.key.toLowerCase());
    if (spec) {
      e.preventDefault();
      setTool(spec.tool);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  /* ---- making things -------------------------------------------------- */

  const nameOf = (id: string | null): string => state.doc.objects.find((o) => o.id === id)?.name || (id ?? '');
  /** a name as it reads mid-sentence: "Line from the earth", not "from The earth" */
  const inline = (id: string | null): string => nameOf(id).replace(/^The /, 'the ');
  const kindOf = (id: string | null): ObjectKind | undefined => state.doc.objects.find((o) => o.id === id)?.kind;
  /** a snap as a place: the object itself, a sphere's centre as the live
   * expression it is, or a fixed point on the ring */
  const pointOf = (s: Snap): PointValue =>
    s.kind === 'object' && s.id !== null
      ? { ref: s.id }
      : s.kind === 'centre' && s.id !== null
        ? { expr: `${varName(s.id)}.centerAt(f)` }
        : { x: round(s.world.x), y: round(s.world.y) };
  const bearing = (from: Vec, to: Vec): number => Math.round(norm360(lonOf(sub(to, from)))) % 360;
  const dist = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);
  /** a length that looks like `px` on screen right now, in world px */
  const onScreen = (px: number): number => Math.max(1, Math.round(px / stage.camera.zoom));
  /** the object the camera holds still, when there is one — the natural
   * "from" for a sightline and "centre" for a reading */
  const viewRef = (): string | null => {
    const id = state.doc.view.refId;
    return id !== undefined && state.doc.objects.some((o) => o.id === id) ? id : null;
  };
  const fmt = (n: number): string => String(Math.round(n * 100) / 100);

  /** What each tool needs, said when a press lands on nothing. */
  const NEEDS: Partial<Record<ObjectKind, string>> = {
    sphere: 'a sphere is centred on something: the earth, a body, or another sphere’s centre.',
    connector: 'a line runs between objects, or from one toward a longitude on the ring.',
    angle: 'an angle is seen from an object, toward objects or longitudes on the ring.',
    anchor: 'a point marks a body, a sphere’s centre, or a longitude on the ring.',
    trail: 'a trail follows a body — click one.',
    ringmarker: 'a reading is of a body — click one.',
  };

  /** A press with a tool out. The one-click tools make their object here;
   * the others start (or advance) a gesture. */
  function toolDown(kind: ObjectKind, p: Vec): void {
    // the second click of a two-click sphere sets its radius, which may be
    // anywhere — it is a distance, not a place
    if (gesture && gesture.tool === 'sphere' && gesture.down === null) {
      const g = gesture;
      gesture = null;
      finishGesture(g, p);
      return;
    }

    const snap = snapAt(p);
    if (!snap) {
      say(`Nothing to attach to there — ${NEEDS[kind] ?? ''}`);
      return;
    }
    switch (kind) {
      case 'anchor':
        add(pointFrom(snap));
        break;
      case 'trail':
        add(trailFrom(snap));
        break;
      case 'ringmarker':
        add(readingFrom(snap));
        break;
      case 'sphere':
        gesture = { tool: kind, snaps: [snap], down: p };
        break;
      case 'connector':
        if (!gesture) gesture = { tool: kind, snaps: [snap], down: p };
        else {
          const g = gesture;
          gesture = null;
          const [start] = g.snaps;
          if (start) add(lineFrom(start, snap));
        }
        break;
      case 'angle':
        if (!gesture) gesture = { tool: 'angle', snaps: [snap], down: null };
        else {
          gesture.snaps.push(snap);
          const [v, a, b] = gesture.snaps;
          if (v && a && b) {
            gesture = null;
            add(angleFrom(v, a, b));
          }
        }
        break;
    }
  }

  /** A drag tool let go, or a two-click tool clicked the second time. */
  function finishGesture(g: Gesture, screen: Vec): void {
    const start = g.snaps[0];
    if (!start) return;
    if (g.tool === 'sphere') {
      add(sphereFrom(start, sphereRadius(start, screen).value));
    } else if (g.tool === 'connector') {
      const end = snapAt(screen, ['object', 'centre', 'ring']);
      if (!end || (end.kind === start.kind && end.id === start.id)) {
        say(`Nothing to attach to there — ${NEEDS.connector}`);
        return;
      }
      add(lineFrom(start, end));
    }
  }

  function add(obj: ObjectDoc): void {
    // Born with a real name ("the earth to the moon"), it gets an id from it,
    // so the emitted source says `earthToTheMoon`, not `connector1`.
    if (obj.name !== defaultName(obj.kind, obj.id)) {
      const id = idFromName(obj.name, new Set(state.doc.objects.map((o) => o.id)));
      if (id !== null) obj.id = id;
    }
    state.edit((d) => {
      d.objects.push(obj);
    }, { label: `add ${obj.kind}` });
    state.select(obj.id);
    panel = 'object';
    tool = 'select';
    gesture = null;
    renderAll();
  }

  function pointFrom(s: Snap): ObjectDoc {
    const id = uniqueId(state.doc, 'anchor');
    const name =
      s.kind === 'ring' ? formatLongitude(s.lon ?? 0) : s.kind === 'centre' ? `${nameOf(s.id)}’s centre` : `Point on ${inline(s.id)}`;
    return { kind: 'anchor', id, name, marker: 'cross', at: pointOf(s) };
  }

  function sphereFrom(center: Snap, radius: number | null): ObjectDoc {
    const id = uniqueId(state.doc, 'sphere');
    // Pressed on a body: this sphere rides it — an epicycle. Smaller and
    // quicker by default, since that is what an epicycle nearly always is.
    const epicycle = center.kind === 'object' && kindOf(center.id) === 'sphere';
    return {
      kind: 'sphere',
      id,
      name: epicycle ? `Epicycle on ${inline(center.id)}` : defaultName('sphere', id),
      center: pointOf(center),
      radius: radius ?? onScreen(epicycle ? 22 : 70),
      speed: epicycle ? 90 : 30,
    };
  }

  function lineFrom(start: Snap, end: Snap): ObjectDoc {
    const id = uniqueId(state.doc, 'connector');
    if (end.kind === 'ring') {
      // A sightline: from something, toward a longitude, out to the ring —
      // dashed, this kit's convention for a direction rather than a route.
      return {
        kind: 'connector',
        id,
        name: `Toward ${formatLongitude(end.lon ?? 0)}`,
        from: pointOf(start),
        toward: end.lon ?? 0,
        length: state.doc.zodiac !== false ? { expr: 'ringOuter(f)' } : round(dist(start.world, end.world)),
        dashed: true,
      };
    }
    // Joined: a line between two things, which follows both.
    return {
      kind: 'connector',
      id,
      name: `${nameOf(start.id) || start.name} to ${inline(end.id) || end.name}`,
      from: pointOf(start),
      to: pointOf(end),
      shorten: 6,
    };
  }

  function angleFrom(vertex: Snap, a: Snap, b: Snap): ObjectDoc {
    const id = uniqueId(state.doc, 'angle');
    // An arm on an object follows it; one on the ring points at that
    // longitude — the sky at infinity, the same from any vertex.
    const arm = (s: Snap): DirValue =>
      s.kind === 'object' && s.id !== null && s.id !== vertex.id ? { ref: s.id } : s.kind === 'ring' ? (s.lon ?? 0) : bearing(vertex.world, s.world);
    const reach = Math.min(dist(vertex.world, a.world), dist(vertex.world, b.world));
    return {
      kind: 'angle',
      id,
      name: `${a.kind === 'ring' ? a.name.replace(/ on the ring$/, '') : nameOf(a.id)} – ${b.kind === 'ring' ? b.name.replace(/ on the ring$/, '') : inline(b.id)}`,
      vertex: pointOf(vertex),
      from: arm(a),
      to: arm(b),
      radius: Math.max(onScreen(14), Math.round(reach * 0.35)),
      short: true,
      showValue: true,
    };
  }

  function trailFrom(s: Snap): ObjectDoc {
    const id = uniqueId(state.doc, 'trail');
    const ref = viewRef();
    return {
      kind: 'trail',
      id,
      name: `${nameOf(s.id)}’s trail`,
      target: pointOf(s),
      ...(ref !== null && ref !== s.id ? { relativeTo: { ref } } : {}),
      span: 5,
      step: 0.05,
      bands: 8,
    };
  }

  function readingFrom(s: Snap): ObjectDoc {
    const id = uniqueId(state.doc, 'ringmarker');
    const ref = viewRef();
    const center = ref !== null ? (snapOf(ref)?.world ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const target = s.id !== ref ? s : null;
    return {
      kind: 'ringmarker',
      id,
      name: target ? `${nameOf(target.id)} on the ring` : defaultName('ringmarker', id),
      ...(ref !== null ? { center: { ref } } : {}),
      // on the ring when there is one, so the mark sits on the circle drawn
      radius: state.doc.zodiac !== false ? { expr: 'ringRadius(f)' } : Math.max(onScreen(40), Math.round(dist(center, s.world) * 1.25)),
      toward: target && target.id !== null ? { ref: target.id } : bearing(center, s.world),
    };
  }

  /** "Build on it" — the things one most often adds to whatever is selected,
   * one click each. */
  function quickActions(o: ObjectDoc): QuickAction[] {
    const here = snapOf(o.id);
    if (!here) return [];
    const item = state.fig.items.get(o.id);
    const out: QuickAction[] = [];
    if (item instanceof Sphere && o.kind === 'sphere' && (o.eccentric !== undefined || (o.center !== undefined && !isRef(o.center)))) {
      const c: Snap = { kind: 'centre', id: o.id, world: item.centerAt(state.frame()), name: `centre of ${inline(o.id)}` };
      out.push({ label: '✛ Mark its centre', title: 'A named point at this sphere’s own centre', run: () => add(pointFrom(c)) });
    }
    const hasBody = item instanceof Sphere ? item.showBody : true;
    if (!hasBody) return out;
    const ref = viewRef();
    out.push({
      label: o.kind === 'sphere' ? '◯ Epicycle on it' : '◯ Sphere round it',
      title: 'A new sphere centred on this, which goes wherever it goes',
      run: () => add(sphereFrom(here, null)),
    });
    if (ref !== null && ref !== o.id) {
      const from = snapOf(ref);
      if (from) {
        out.push({
          label: `╱ Line from ${inline(ref)}`,
          title: `A line from ${inline(ref)} to this, following both`,
          run: () => add(lineFrom(from, here)),
        });
      }
    }
    if (o.kind === 'sphere') {
      out.push({ label: '⋰ Trail it', title: 'Draw where it has been', run: () => add(trailFrom(here)) });
    }
    if (o.kind !== 'ringmarker' && o.id !== ref) {
      out.push({
        label: '⊙ Read it on the ring',
        title: 'Mark the longitude it is seen at',
        run: () => add(readingFrom(here)),
      });
    }
    return out;
  }

  function startPick(id: string, path: string, label: string, accepts: 'point' | 'dir'): void {
    tool = 'select';
    gesture = null;
    pick = { id, path, label, accepts };
    state.setPlaying(false);
    stageEl.focus({ preventScroll: true });
    renderToolbar();
  }

  function completePick(s: Snap): void {
    const p = pick;
    if (!p) return;
    if (s.kind === 'object' && s.id === p.id) {
      say('It can’t refer to itself — click something else.');
      return;
    }
    const value: PointValue | DirValue =
      p.accepts === 'point' ? pointOf(s) : s.kind === 'ring' ? (s.lon ?? 0) : { ref: s.id as string };
    pick = null;
    state.edit((d) => {
      const target = d.objects.find((x) => x.id === p.id);
      if (!target) return false;
      setPath(target as unknown as Record<string, unknown>, p.path, value);
    }, { label: `set ${p.path}` });
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
        'data-fkey': 'doc:title',
        value: state.doc.name,
        title: 'What this figure is called',
        oninput: (e: Event) =>
          state.edit((d) => {
            d.name = (e.target as HTMLInputElement).value;
          }, { label: 'name', coalesce: 'doc:name' }),
      }),
      el('div', { class: 'cdx-tools', role: 'toolbar', 'aria-label': 'Tools' },
        ...TOOLS.map((t) =>
          el('button', {
            type: 'button',
            class: `cdx-tool${tool === t.tool ? ' is-on' : ''}`,
            'aria-pressed': tool === t.tool ? 'true' : 'false',
            title: `${t.label} (${t.key.toUpperCase()})${t.steps[0] ? ` — ${t.steps[0]}` : ''}`,
            onclick: () => setTool(tool === t.tool ? 'select' : t.tool),
          },
            el('span', { class: 'cdx-tool-icon', text: t.icon }),
            el('span', { text: t.label }),
          ),
        ),
      ),
      el('button', {
        type: 'button',
        class: `cdx-toggle${state.doc.zodiac !== false ? ' is-on' : ''}`,
        'aria-pressed': state.doc.zodiac !== false ? 'true' : 'false',
        text: '✦ Mazalot',
        title: 'The ring of the twelve signs round the figure — what longitudes are read against, and what lines and angles can point at. More in Figure.',
        onclick: toggleMazalot,
      }),
      el('span', { class: 'cdx-spacer' }),
      el('button', { type: 'button', text: '↶', title: 'Undo (Ctrl+Z)', disabled: !state.canUndo(), onclick: () => { state.undo(); renderAll(); } }),
      el('button', { type: 'button', text: '↷', title: 'Redo (Ctrl+Shift+Z)', disabled: !state.canRedo(), onclick: () => { state.redo(); renderAll(); } }),
      el('span', { class: 'cdx-spacer' }),
      el('button', { type: 'button', class: 'cdx-primary', text: 'Code', title: 'The component this figure emits as', onclick: () => showCode() }),
      el('button', { type: 'button', text: 'JSON', title: 'Save or load this figure as a document', onclick: () => showJson() }),
      ...(opts.examples && opts.examples.length > 0
        ? [select(
            [{ value: '', label: 'Open example…' }, ...opts.examples.map((x, i) => ({ value: String(i), label: x.name }))],
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
      select(
        [
          { value: '', label: 'New…' },
          { value: 'earth', label: 'About the earth (the Rambam)' },
          { value: 'sun', label: 'About the sun (modern)' },
        ],
        '',
        (v) => {
          if (v === '') return;
          state.load(v === 'sun' ? sunCentred() : earthCentred(), 'new');
          renderAll();
        },
        { title: 'Start a new figure' },
      ),
    );
  }

  /** The mazalot ring, on or off — sized to the figure, and the view re-fitted
   * to take it in. */
  function toggleMazalot(): void {
    const on = state.doc.zodiac !== false;
    state.edit((d) => {
      d.zodiac = on
        ? false
        : { radius: 'auto', padding: 22, band: 20, segments: MAZALOT.map((m) => ({ ...m })), language: 'en' };
    }, { label: on ? 'remove the mazalot ring' : 'add the mazalot ring' });
    refitNext = true;
  }

  function renderList(): void {
    clear(listPanel);
    listPanel.appendChild(el('h4', { class: 'cdx-group', text: 'In this figure' }));
    if (state.doc.objects.length === 0) {
      listPanel.appendChild(el('p', { class: 'cdx-empty', text: 'Nothing yet. Pick a tool above and draw.' }));
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

  /** What the panel says before anything is selected: how to start. */
  function gettingStarted(): HTMLElement {
    const line = (icon: string, what: string, how: string): HTMLElement =>
      el('li', {}, el('span', { class: 'cdx-tool-icon', text: icon }), el('span', {}, el('strong', { text: what }), ` — ${how}`));
    return el('div', { class: 'cdx-start' },
      el('p', { text: 'Draw with the tools above. Every press attaches to something — a body, a point, a sphere’s centre, or a degree of the ring — and follows it when it moves.' }),
      el('ul', {},
        line('◯', 'Sphere (S)', 'press on the earth and drag out the radius. Press on a body instead for an epicycle, or on a sphere’s centre.'),
        line('╱', 'Line (L)', 'drag from one object to another — or to a degree of the mazalot ring, for a sightline.'),
        line('∠', 'Angle (A)', 'click the vertex, then the two things it lies between — objects, or degrees of the ring.'),
        line('⋰', 'Trail (T) · ⊙ Reading (R)', 'click a body.'),
        line('✦', 'Mazalot', 'the ring of signs, for readings, sightlines and angles to a longitude.'),
      ),
      el('p', { text: 'Then set exact values in the panel, as your source gives them: 13°10′35″ a day, 26°45′ Gemini, 2;30 parts of 60 — or 27.32 days, 0.0417.' }),
      el('p', { text: 'Click anything to edit it, and drag its handles to reshape it. Space runs the clock, F fits the view, Esc puts a tool down.' }),
    );
  }

  function renderPanel(): void {
    // A rebuild must not throw the panel back to its top: committing a value
    // halfway down would otherwise lose your place every time.
    const scrolled = panelBody.scrollTop;
    const sameObject = panelFor === `${panel}:${state.selectedId ?? ''}`;
    panelFor = `${panel}:${state.selectedId ?? ''}`;
    renderPanelBody();
    if (sameObject) panelBody.scrollTop = scrolled;
  }

  /** what the panel was last built for — its scroll is kept only while that holds */
  let panelFor = '';

  function renderPanelBody(): void {
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
    if (panel === 'object') {
      const o = state.selected();
      renderInspector(panelBody, state, {
        actions: [
          ...(o ? quickActions(o) : []),
          ...(o
            ? [
                { label: 'Duplicate', title: 'A copy of it (Ctrl+D)', run: duplicateSelected },
                { label: 'Delete', title: 'Remove it (Delete)', run: removeSelected },
              ]
            : []),
        ],
        startPick,
        empty: gettingStarted(),
      });
    } else {
      renderFigurePanel(panelBody, state);
      for (const [i, field] of panelBody.querySelectorAll<HTMLElement>('input, select, textarea').entries()) {
        field.dataset['fkey'] ??= `figure:${i}`;
      }
    }
  }

  const clockLabel = el('span', { class: 'cdx-clocklabel' });
  const clockRange = el('input', { type: 'range', class: 'cdx-scrub' });

  function renderControls(): void {
    clear(controlsEl);
    const playBtn = el('button', {
      type: 'button',
      class: 'cdx-play',
      text: state.playing ? '❚❚' : '▶',
      title: state.playing ? 'Pause the clock (Space)' : 'Run the clock (Space)',
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
    controlsEl.appendChild(
      el('button', { type: 'button', text: 'Fit', title: 'Fit the view to the figure (F)', onclick: () => refit() }),
    );
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

  /**
   * Rebuild every panel from the state — and hand focus back to whatever
   * field had it. Every edit rebuilds, including the one each keystroke in a
   * text field makes, so without this a field keeps its focus for exactly one
   * character. Fields are found again by `data-fkey`; the ones built without
   * one (the figure panel's) are keyed by their order, which a keystroke does
   * not change.
   */
  function renderAll(): void {
    const active = document.activeElement;
    const key = active instanceof HTMLElement && host.contains(active) ? active.dataset['fkey'] : undefined;
    const caret =
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.selectionStart : null;

    renderToolbar();
    renderList();
    renderPanel();
    renderControls();
    renderProblems();

    if (key === undefined || document.activeElement === active) return;
    const again = host.querySelector<HTMLElement>(`[data-fkey="${CSS.escape(key)}"]`);
    if (!again) return;
    again.focus({ preventScroll: true });
    if (caret !== null && (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)) {
      try {
        again.setSelectionRange(caret, caret);
      } catch {
        // some input types refuse a selection; the focus is what matters
      }
    }
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
    let target: 'component' | 'scene' = 'component';
    const area = el('textarea', { class: 'cdx-code', spellcheck: 'false', readonly: true });
    const title = el('strong', {});
    const fill = (): void => {
      const emitted = emitDocument(state.doc, { ...(opts.emit ?? {}), target });
      area.value = emitted.code;
      title.textContent = emitted.filename;
    };
    fill();
    const copyBtn = el('button', {
      type: 'button',
      text: 'Copy',
      onclick: () => {
        void navigator.clipboard?.writeText(area.value).then(() => {
          copyBtn.textContent = 'Copied';
          setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
        });
      },
    });
    showDrawer('', area, [
      title,
      select(
        [
          { value: 'component', label: 'a whole component' },
          { value: 'scene', label: 'the declarations only' },
        ],
        target,
        (v) => {
          target = v as 'component' | 'scene';
          fill();
        },
        { title: 'A complete .astro component, or just the objects to paste into a figure of your own' },
      ),
      copyBtn,
      el('button', {
        type: 'button',
        text: 'Download',
        onclick: () => download(title.textContent ?? 'Figure.astro', area.value, 'text/plain'),
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
      document.removeEventListener('keydown', onKeyDown);
      unsubscribe();
      unwireResize();
      stage.destroy();
      clear(host);
      host.classList.remove('cdx');
    },
  };
}

/* -------------------------------------------------------------------------
 * Starting points
 * ---------------------------------------------------------------------- */

/** The Rambam's world: the earth at the centre, the mazalot round the edge,
 * and a clock that counts days from his epoch. */
function earthCentred(): DiagramDoc {
  const doc = emptyDoc();
  doc.clock = { ...doc.clock, unit: 'days', running: true };
  doc.zodiac = { radius: 'auto', padding: 22, band: 20, segments: MAZALOT.map((m) => ({ ...m })), language: 'en' };
  return doc;
}

/** The modern arrangement: the sun at the centre, and a clock quick enough
 * that the outer planets are seen to move. */
function sunCentred(): DiagramDoc {
  const doc = emptyDoc();
  doc.objects = [centralSun()];
  doc.view = { fitRadius: 'auto', refId: 'sun', lightId: 'sun' };
  doc.clock = { ...doc.clock, unit: 'days', speed: 30, scrub: 12000, running: true };
  return doc;
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

/** "Sphere 2" for `sphere-2` — the name takes its number from the id rather
 * than counting what is already there, so the two never disagree. */
function defaultName(kind: ObjectKind, id: string): string {
  return `${KIND_LABELS[kind]} ${id.slice(kind.length + 1)}`;
}

function uniqueId(doc: DiagramDoc, kind: ObjectKind): string {
  const taken = new Set(doc.objects.map((o) => o.id));
  for (let i = 1; ; i++) {
    const id = `${kind}-${i}`;
    if (!taken.has(id)) return id;
  }
}

/** World px to a tenth — a drag produces a float per pixel of travel, and a
 * document full of `33.99999999999999` is one nobody wants to diff. */
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
