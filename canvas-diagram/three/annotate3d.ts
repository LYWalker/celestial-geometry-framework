/**
 * The half of a canvas-diagram figure that three.js has no opinion about.
 *
 * three.js draws the geometry: perspective, depth, lighting, occlusion — all
 * the things the 2D layer in this kit cannot do, and the reason a figure
 * reaches for it at all. What it does not do is the part these figures are
 * actually *about*: naming what is on screen, keeping those names from
 * piling on top of each other, explaining a thing when you point at it, and
 * leaving a text alternative behind for anyone who cannot see any of it.
 *
 * So this is a thin layer over a 2D canvas stacked on top of the WebGL one.
 * An author registers named points in world space; every frame this projects
 * them through the same camera three.js just rendered with, hides the ones
 * that have gone behind something, and hands the survivors to the same
 * collision-avoiding `drawLabels()` the rest of the kit uses. The figures
 * end up looking like each other, whichever renderer drew the picture.
 *
 * Deliberately *not* a scene graph. three.js already has one, and wrapping
 * it would mean an author learning two. Meshes, materials and lights are
 * declared in three's own vocabulary; only the annotation is borrowed.
 */

import type { Box, Vec } from '../geometry.js';
import { drawLabels, type Face, type Label, type LabelTheme } from '../labels.js';

/**
 * The minimum this module needs from three, expressed structurally so the
 * kit does not take a hard dependency on three's types (or its version) for
 * what amounts to "a point, a camera, and a way to cast a ray".
 */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}
export interface CameraLike {
  position: Vector3Like;
}
/** `(point, camera) => ndc`, i.e. three's `Vector3.project()`, passed in
 * rather than imported so this file never has to load three itself. */
export type ProjectFn = (p: Vector3Like, camera: CameraLike) => Vector3Like;
/** `(from, to) => is something solid in the way` — three's Raycaster,
 * wrapped by the figure, which is the only thing that knows what counts as
 * solid in its own scene. */
export type OccludedFn = (worldPoint: Vector3Like) => boolean;

export interface Annotation {
  id: string;
  /** what it is called; also what the text alternative lists */
  name: string;
  /** a sentence or two, shown when the pointer is on it and read out in the
   * text alternative — the same two channels the 2D kit uses */
  description?: string;
  /** where it is in world space, resolved every frame because everything in
   * these figures moves */
  at: () => Vector3Like;
  /** the second line of the drawn label: a gloss, or a live reading. A
   * function, so it can state a number that changes. */
  gloss?: () => string | undefined;
  color?: string;
  /** which way from its point the name would rather sit, screen space */
  dir?: Vec;
  /** clearance between point and text, screen px */
  gap?: number;
  /** who keeps their name when there isn't room for everyone; lower first */
  rank?: number;
  /** draw a dot and a thread from the point to the text. Default true. */
  leader?: boolean;
  /** skip it this frame — a construction that is only sometimes relevant */
  hidden?: () => boolean;
  /** how near the pointer has to be, screen px, for this to be the thing
   * being pointed at. 0 to make it unpointable. Default 14. */
  hitRadius?: number;
  /** hide the name when something solid is between it and the camera.
   * Default true: a name floating over the far side of the earth is worse
   * than no name at all, because it looks like it belongs to whatever it is
   * floating over. */
  occludable?: boolean;
  font?: Face;
  subFont?: Face;
}

export interface Annotator3DOptions {
  /** the 2D canvas stacked over the WebGL one */
  canvas: HTMLCanvasElement;
  theme: LabelTheme;
  project: ProjectFn;
  /** what counts as solid, for hiding names behind things. Omit for a
   * figure where nothing can hide anything. */
  occluded?: OccludedFn;
  /** the hover tooltip's elements, if the figure has one */
  tip?: { root: HTMLElement; text: HTMLElement; sub: HTMLElement };
}

export class Annotator3D {
  private items: Annotation[] = [];
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private pointer: Vec | null = null;
  private hoveredId: string | null = null;

  constructor(private opts: Annotator3DOptions) {
    this.ctx = opts.canvas.getContext('2d')!;
  }

  add(a: Annotation): this {
    this.items.push(a);
    return this;
  }

  /** Match the overlay to the WebGL canvas's CSS size. Called from the same
   * resize handler that sizes the renderer, so the two can't disagree about
   * how big a pixel is. */
  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.opts.canvas.width = Math.round(width * this.dpr);
    this.opts.canvas.height = Math.round(height * this.dpr);
    this.opts.canvas.style.width = `${width}px`;
    this.opts.canvas.style.height = `${height}px`;
  }

  setPointer(p: Vec | null): void {
    this.pointer = p;
  }

  /** Whatever the pointer is on, as of the last draw. */
  get hovered(): Annotation | null {
    return this.items.find((a) => a.id === this.hoveredId) ?? null;
  }

  /**
   * Project, hide what is behind something, decide what is being pointed
   * at, and lay the names out. Call once per frame *after* the WebGL render,
   * since this paints over it.
   */
  draw(
    camera: CameraLike,
    opts: {
      obstacles?: Box[];
      /** paint on the overlay after it is cleared but before the names go
       * down — a vignette, most usefully, which belongs over the rendered
       * scene but under the text that has to stay readable on top of it. */
      beforeLabels?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
    } = {},
  ): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    opts.beforeLabels?.(ctx, this.w, this.h);

    type Placed = { a: Annotation; screen: Vec; ndcZ: number };
    const visible: Placed[] = [];
    for (const a of this.items) {
      if (a.hidden?.()) continue;
      const world = a.at();
      const ndc = this.opts.project(world, camera);
      // Behind the camera, or past the far plane: three's project() flips
      // the sign behind the eye, which would otherwise place the label on
      // the opposite side of the screen rather than nowhere.
      if (ndc.z < -1 || ndc.z > 1) continue;
      if ((a.occludable ?? true) && this.opts.occluded?.(world)) continue;
      visible.push({
        a,
        screen: { x: (ndc.x * 0.5 + 0.5) * this.w, y: (-ndc.y * 0.5 + 0.5) * this.h },
        ndcZ: ndc.z,
      });
    }

    // What the pointer is on: the nearest within its own hit radius, and on
    // a tie the one closest to the camera, since that is the one actually
    // under the pointer rather than the one behind it.
    let best: Placed | null = null;
    let bestScore = Infinity;
    if (this.pointer) {
      for (const p of visible) {
        const r = p.a.hitRadius ?? 14;
        if (r <= 0) continue;
        const d = Math.hypot(p.screen.x - this.pointer.x, p.screen.y - this.pointer.y);
        if (d > r) continue;
        const score = d + p.ndcZ * 0.001;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    this.hoveredId = best?.a.id ?? null;
    this.syncTip(best?.a ?? null);

    const theme = this.opts.theme;
    const labels: Label[] = visible.map(({ a, screen }, i) => {
      const active = a.id === this.hoveredId;
      return {
        text: a.name,
        sub: a.gloss?.(),
        x: screen.x,
        y: screen.y,
        dir: a.dir ?? { x: 0.7071, y: -0.7071 },
        gap: a.gap ?? 10,
        active,
        rank: a.rank ?? 40 + i,
        color: a.color,
        // Resolved here rather than left undefined for drawLabels to fill
        // in: `Label.font` is not widened to accept an explicit `undefined`
        // under exactOptionalPropertyTypes, and picking the active face is
        // the only thing that default would have done anyway.
        font: a.font ?? (active ? theme.activeFont : theme.font),
        subFont: a.subFont ?? theme.subFont,
        alpha: 1,
        leader: a.leader ?? true,
      };
    });

    drawLabels(
      ctx,
      labels,
      { obstacles: opts.obstacles ?? [], width: this.w, safeBottom: this.h },
      this.opts.theme,
    );
  }

  private syncTip(a: Annotation | null): void {
    const tip = this.opts.tip;
    if (!tip) return;
    if (!a || !this.pointer) {
      tip.root.hidden = true;
      return;
    }
    tip.root.hidden = false;
    tip.text.textContent = a.name;
    tip.sub.textContent = a.description ?? '';
    // kept inside the frame, so a name near the right edge doesn't push its
    // own explanation off it
    const pad = 14;
    const w = tip.root.offsetWidth || 220;
    const h = tip.root.offsetHeight || 60;
    tip.root.style.left = `${Math.min(Math.max(this.pointer.x + pad, 4), Math.max(4, this.w - w - 4))}px`;
    tip.root.style.top = `${Math.min(Math.max(this.pointer.y + pad, 4), Math.max(4, this.h - h - 4))}px`;
  }

  /**
   * The figure's text alternative: every named thing and what it is. Derived
   * from the same registrations the picture is drawn from, never a second
   * list, so it cannot drift from what is actually on screen.
   */
  describeInto(el: Element): void {
    el.replaceChildren();
    const doc = el.ownerDocument;
    for (const a of this.items) {
      const li = doc.createElement('li');
      li.textContent = a.description ? `${a.name}: ${a.description}` : a.name;
      el.appendChild(li);
    }
  }
}
