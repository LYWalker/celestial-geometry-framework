/**
 * A whole figure in one call.
 *
 * Declaring a scene is short. What used to follow it was not: a canvas and a
 * tooltip in the markup, a HoverController over them, a Stage, a clock, a
 * resize that fits the ring, a draw, wireCamera, wireResize,
 * wireAnimationLoop, the screen-reader list, a teardown, and the page-load
 * bookkeeping that finds every instance on the page — about a hundred lines,
 * the same in every component, and easy to get subtly wrong in one of them.
 *
 * `mountFigure` is those hundred lines, once:
 *
 *   const earth = new Anchor({ id: 'earth', name: 'The earth' });
 *   const sun = new Sphere({ id: 'sun', name: 'The sun', center: earth, radius: 100, speed: 1 });
 *
 *   mountAll('[data-my-figure]', (el) =>
 *     mountFigure(el, { scene: new Scene().add(earth).add(sun), ref: earth, zodiac: { segments: MAZALOT } }),
 *   );
 *
 * Everything it builds is still reachable from the handle it returns — the
 * Stage, the HoverController, the Frame it last drew — so a figure that
 * outgrows it can take one piece over rather than starting again.
 */

import type { Vec } from '../geometry.js';
import { HoverController } from '../hover.js';
import { DEFAULT_BACKGROUND, DEFAULT_THEME } from './defaults.js';
import { describeSceneInto } from './describe.js';
import type { Scene, SceneItem, SceneTheme } from './scene.js';
import { Stage, wireAnimationLoop, wireCamera, wireResize, type BackgroundTheme } from './stage.js';
import { frame, type Frame, type PointLike } from './types.js';
import type { ZodiacConfig, ZodiacRing } from './zodiac.js';

/** One named amount besides the clock, and the control the figure gives it. */
export interface FigureParam {
  /** the key it is read under — `f.shells` for `key: 'shells'` */
  key: string;
  /** what the control is labelled. The key, when omitted. */
  label?: string;
  /** `range` draws a slider; `toggle` a checkbox reading 0 or 1 */
  control?: 'range' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  /** where it starts */
  value: number;
}

export interface FigureOptions {
  /** what the figure is */
  scene: Scene;
  /** the point the camera holds still — usually the earth. The origin when omitted. */
  ref?: PointLike;
  /** where light comes from, for bodies drawn with a lit renderer */
  light?: PointLike;
  /** only the parts that differ from the house style */
  theme?: Partial<SceneTheme>;
  /** the sky behind it. The house sky when omitted; `false` for none. */
  background?: BackgroundTheme | false;
  /** the ring of named segments at its edge, if any */
  zodiac?: ZodiacConfig | ZodiacRing | false;
  /**
   * How the clock runs: `speed` units of `f.t` per real second, from `start`.
   * `running: false` holds it at `start` — a still figure that still pans,
   * zooms and explains itself on hover.
   */
  clock?: { speed?: number; start?: number; running?: boolean };
  /** named amounts besides the clock, each given a control under the figure */
  params?: FigureParam[];
  /**
   * How much of the world fills the frame, world px from the centre. `'auto'`
   * (the default) fits whatever the scene and its ring reach.
   */
  fit?: number | 'auto';
  /** how far in and out the camera may go, as multiples of the fitted zoom */
  zoom?: { min?: number; max?: number };
  /** the stage's shape, as a CSS aspect-ratio. `'4 / 3'` by default. */
  aspect?: string;
  /** what a screen reader announces the figure as */
  label?: string;
  /** a click on the figure, with whatever was under it */
  onClick?: (hit: SceneItem | null, f: Frame) => void;
  /** after every draw — for a readout beside the figure */
  onFrame?: (f: Frame) => void;
}

export interface Figure {
  readonly scene: Scene;
  readonly stage: Stage;
  readonly hover: HoverController;
  /** the clock's current reading */
  readonly t: number;
  /** the Frame that was last drawn */
  frame(): Frame;
  /** set a parameter (and its control) and redraw */
  set(key: string, value: number): void;
  play(): void;
  pause(): void;
  /** move the clock to `t` */
  seek(t: number): void;
  draw(): void;
  destroy(): void;
}

/**
 * Build a figure inside `host`, which it fills: a canvas with pan, zoom,
 * keyboard control and hover explanations, a control per parameter, and a
 * screen-reader list of what is in it.
 */
export function mountFigure(host: HTMLElement, opts: FigureOptions): Figure {
  injectStyles();
  const { scene } = opts;
  const ref = opts.ref ?? { x: 0, y: 0 };
  const theme: SceneTheme = { ...DEFAULT_THEME, ...opts.theme };

  /* ---- markup --------------------------------------------------------- */
  host.classList.add('cgf-figure');
  const canvas = document.createElement('canvas');
  const tip = el('div', 'cgf-tip');
  tip.hidden = true;
  const tipText = el('span', 'cgf-tip-text');
  const tipSub = el('span', 'cgf-tip-sub');
  tip.append(tipText, tipSub);
  const stageEl = el('div', 'cgf-stage');
  stageEl.tabIndex = 0;
  stageEl.style.aspectRatio = opts.aspect ?? '4 / 3';
  stageEl.setAttribute('role', 'img');
  stageEl.setAttribute(
    'aria-label',
    `${opts.label ?? 'An interactive figure'}. Drag to pan, scroll to zoom, hover anything for what it is. Arrow keys pan, plus and minus zoom, 0 resets, once it has focus.`,
  );
  stageEl.append(canvas, tip);
  const list = el('div', 'cgf-sr-only');
  // Put in front of whatever the host already holds, so a caption written in
  // the markup stays beneath the figure it describes.
  const added: HTMLElement[] = [stageEl];

  /* ---- parameters ----------------------------------------------------- */
  const params: Record<string, number> = {};
  const inputs = new Map<string, HTMLInputElement>();
  if (opts.params && opts.params.length > 0) {
    const controls = el('div', 'cgf-controls');
    for (const p of opts.params) {
      params[p.key] = p.value;
      const input = document.createElement('input');
      if (p.control === 'toggle') {
        input.type = 'checkbox';
        input.checked = p.value !== 0;
        input.addEventListener('change', () => set(p.key, input.checked ? 1 : 0));
      } else {
        input.type = 'range';
        input.min = String(p.min ?? 0);
        input.max = String(p.max ?? 1);
        input.step = String(p.step ?? 0.01);
        input.value = String(p.value);
        input.addEventListener('input', () => set(p.key, Number(input.value)));
      }
      inputs.set(p.key, input);
      const label = el('label', 'cgf-ctl');
      label.append(el('span', '', p.label ?? p.key), input);
      controls.append(label);
    }
    added.push(controls);
  }
  host.prepend(...added);
  host.append(list);
  added.push(list);
  describeSceneInto(list, scene);

  /* ---- the stage ------------------------------------------------------ */
  const hover = new HoverController({ root: tip, text: tipText, sub: tipSub });
  const stage = new Stage({
    canvas,
    background: opts.background === undefined ? DEFAULT_BACKGROUND : opts.background,
    zodiac: opts.zodiac ?? false,
  });

  /* ---- the clock ------------------------------------------------------ */
  const speed = opts.clock?.speed ?? 1;
  let running = opts.clock?.running ?? true;
  let base = opts.clock?.start ?? 0;
  let since = performance.now();
  const clock = (): number => (running ? base + ((performance.now() - since) / 1000) * speed : base);

  let pointer: Vec | null = null;
  let last: Frame = frame(clock(), params);

  function draw(): void {
    // One Frame per draw, threaded through everything: the scene layer's
    // memos are keyed on its identity.
    last = frame(clock(), params);
    stage.render({
      scene,
      f: last,
      ref,
      theme,
      hover,
      pointer,
      ...(opts.light !== undefined ? { lightSource: opts.light } : {}),
    });
    opts.onFrame?.(last);
  }

  function resize(): void {
    let fit: number;
    if (typeof opts.fit === 'number') fit = opts.fit;
    else {
      const f = frame(clock(), params);
      fit = (stage.zodiacGeometry(f, scene)?.outer ?? scene.extent(f)) + 12;
    }
    stage.resize({ fitRadius: Math.max(10, fit) });
    draw();
  }

  function set(key: string, value: number): void {
    params[key] = value;
    const input = inputs.get(key);
    if (input) {
      if (input.type === 'checkbox') input.checked = value !== 0;
      else input.value = String(value);
    }
    draw();
  }

  const unwireResize = wireResize(stageEl, resize);
  const unwireCamera = wireCamera({
    canvas,
    camera: stage.camera,
    minZoom: () => stage.fit * (opts.zoom?.min ?? 0.5),
    maxZoom: () => stage.fit * (opts.zoom?.max ?? 8),
    onChange: draw,
    onHover: (p) => {
      pointer = p;
      draw();
    },
    onPointerDown: () => stageEl.focus({ preventScroll: true }),
    ...(opts.onClick
      ? {
          onClick: (p: Vec) => {
            const f = frame(clock(), params);
            opts.onClick?.(scene.hitTest(p, { f, ref, camera: stage.camera, shapes: true }), f);
          },
        }
      : {}),
  });
  const unwireLoop = wireAnimationLoop(stageEl, draw);

  return {
    scene,
    stage,
    hover,
    get t() {
      return clock();
    },
    frame: () => last,
    set,
    play(): void {
      if (running) return;
      since = performance.now();
      running = true;
      draw();
    },
    pause(): void {
      if (!running) return;
      base = clock();
      running = false;
      draw();
    },
    seek(t: number): void {
      base = t;
      since = performance.now();
      draw();
    },
    draw,
    destroy(): void {
      unwireLoop();
      unwireCamera();
      unwireResize();
      stage.destroy();
      for (const node of added) node.remove();
      host.classList.remove('cgf-figure');
    },
  };
}

/**
 * Mount a figure on every element matching `selector`, now and after every
 * page navigation, and tear each one down when its page goes away.
 *
 * Works with or without Astro's client router: it mounts on load, again on
 * `astro:page-load` for whatever the new page brought, and tears everything
 * down on `astro:before-swap`. An element that already has its figure is left
 * alone, so the initial load mounting twice is not something to guard against.
 */
export function mountAll(selector: string, init: (el: HTMLElement) => { destroy(): void } | (() => void)): void {
  const mounted = new Map<HTMLElement, () => void>();

  const boot = (): void => {
    for (const [node, teardown] of mounted) {
      if (!node.isConnected) {
        teardown();
        mounted.delete(node);
      }
    }
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      if (mounted.has(node)) continue;
      const made = init(node);
      mounted.set(node, typeof made === 'function' ? made : () => made.destroy());
    }
  };

  const teardownAll = (): void => {
    for (const teardown of mounted.values()) teardown();
    mounted.clear();
  };

  document.addEventListener('astro:page-load', boot);
  document.addEventListener('astro:before-swap', teardownAll);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}

/* ---- helpers ------------------------------------------------------------ */

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const FIGURE_CSS = `
.cgf-figure { margin: 0; }
.cgf-stage { position: relative; width: 100%; border-radius: 10px; overflow: hidden; background: #070b16; touch-action: none; outline: none; }
.cgf-stage:focus-visible { box-shadow: 0 0 0 2px #8fd6c9; }
.cgf-stage canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; cursor: grab; }
.cgf-tip { position: absolute; top: 0; left: 0; z-index: 2; max-width: 16rem; padding: 0.35rem 0.55rem; border-radius: 6px; background: rgba(5, 8, 18, 0.96); border: 1px solid rgba(150, 168, 214, 0.22); color: #e9e6df; font: 500 0.74rem/1.35 "Inter Variable", Inter, system-ui, sans-serif; pointer-events: none; }
.cgf-tip-text { display: block; font-weight: 600; }
.cgf-tip-sub { display: block; margin-top: 0.15rem; color: #96a0bd; }
.cgf-controls { display: flex; flex-wrap: wrap; gap: 0.8rem; margin-top: 0.7rem; }
.cgf-ctl { display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: #96a0bd; }
.cgf-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`;

/** The figure's stylesheet, added once per document. */
function injectStyles(): void {
  if (document.getElementById('cgf-figure-styles')) return;
  const style = document.createElement('style');
  style.id = 'cgf-figure-styles';
  style.textContent = FIGURE_CSS;
  document.head.appendChild(style);
}
