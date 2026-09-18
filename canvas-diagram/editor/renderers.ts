/**
 * The named body renderers a document can pick from, and the registry a host
 * adds its own to.
 *
 * `SphereConfig.render` is a canvas routine, not a value — gradients, a
 * clipped terminator, a tilted ring — and there is no useful way to put one in
 * a JSON document. But the ones that actually get used are a short, reusable
 * list: a lit sphere, a glowing one, a ringed one. So the document names a
 * renderer (`render: { ref: 'lit' }`), the editor offers those names in a
 * menu, and the emitted TypeScript imports the same name from here. A one-off
 * renderer is still writable as an `{ expr }`, which evaluates to a
 * `BodyRenderer` — the escape hatch, not the ordinary road.
 *
 * Every renderer here honours `alpha` itself (Scene does not wrap a renderer
 * in a `globalAlpha`, deliberately — a glow often wants a different one from
 * its disc) and restores `globalAlpha` to 1 when it is done, which is what
 * Scene's own default renderer does and what the code after it assumes.
 */

import { FULL_CIRCLE } from '../geometry.js';
import type { BodyRenderContext, BodyRenderer } from '../scene/types.js';

/** Lighten (`amt > 0`) or darken a `#rrggbb` toward white or black. Only
 * `#rrggbb` is understood, because that is what a colour *picker* produces —
 * a body given an `rgba(...)` falls back to its own colour unshaded rather
 * than to something wrong. */
function shade(color: string, amt: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const n = parseInt(color.slice(1), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** The ring drawn round a hovered body — the same mark for every renderer, so
 * "the pointer is on this one" reads the same wherever it happens. */
function drawHot(ctx: CanvasRenderingContext2D, b: BodyRenderContext): void {
  if (!b.hot) return;
  ctx.save();
  ctx.globalAlpha = b.alpha;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(b.screen.x, b.screen.y, b.r + 3, 0, FULL_CIRCLE);
  ctx.stroke();
  ctx.restore();
}

/** Scene's own default, named so a document can say it explicitly and so the
 * editor's menu has something to mean "back to plain". */
export const plain: BodyRenderer = (ctx, b) => {
  ctx.globalAlpha = b.alpha;
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.arc(b.screen.x, b.screen.y, b.r, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.globalAlpha = 1;
  drawHot(ctx, b);
};

/**
 * A disc with a terminator: lit from the scene's light source, dark on the
 * other side. The figure's point, whenever the phases are the point — at
 * conjunction the moon turns its dark face to the earth, and the picture says
 * so without a caption.
 *
 * With no light source set on the draw call it falls back to a plain disc,
 * rather than picking an arbitrary direction to be lit from: a shadow that is
 * not the sun's is worse than no shadow.
 */
export const lit: BodyRenderer = (ctx, b) => {
  ctx.globalAlpha = b.alpha;
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.arc(b.screen.x, b.screen.y, b.r, 0, FULL_CIRCLE);
  ctx.fill();

  if (b.light) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.screen.x, b.screen.y, b.r, 0, FULL_CIRCLE);
    ctx.clip();
    const g = ctx.createLinearGradient(
      b.screen.x - b.light.x * b.r * 0.4,
      b.screen.y - b.light.y * b.r * 0.4,
      b.screen.x + b.light.x * b.r * 0.5,
      b.screen.y + b.light.y * b.r * 0.5,
    );
    g.addColorStop(0, 'rgba(7,11,22,0.88)');
    g.addColorStop(1, 'rgba(7,11,22,0)');
    ctx.fillStyle = g;
    ctx.fillRect(b.screen.x - b.r, b.screen.y - b.r, b.r * 2, b.r * 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  drawHot(ctx, b);
};

/**
 * A sphere rather than a disc: a highlight toward the light, the body's own
 * colour across the middle, and its own colour darkened at the limb. Reads as
 * round at four pixels across, which a terminator does not — so this is the
 * one for the small bodies in a crowded figure, and `lit` is the one for a
 * body whose *phase* is being shown.
 */
export const shaded: BodyRenderer = (ctx, b) => {
  const { x, y } = b.screen;
  // With no light, the highlight goes up and left: the conventional lighting
  // of a drawn sphere, which reads as roundness rather than as a direction.
  const hx = b.light ? b.light.x : -0.6;
  const hy = b.light ? b.light.y : -0.6;
  const g = ctx.createRadialGradient(x + hx * b.r * 0.4, y + hy * b.r * 0.4, b.r * 0.05, x, y, b.r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, b.color);
  g.addColorStop(1, shade(b.color, -0.45));
  ctx.globalAlpha = b.alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, b.r, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.globalAlpha = 1;
  drawHot(ctx, b);
};

/**
 * A light source: a wide corona, a tighter inner glow, and a disc brightest at
 * its centre. For the one body in a figure that everything else is lit by.
 *
 * The corona breathes slightly, on wall-clock time rather than the figure's
 * own — it should keep moving while the diagram is paused, being a property of
 * the drawing and not of the moment being drawn.
 */
export const sun: BodyRenderer = (ctx, b) => {
  const { x, y } = b.screen;
  const breathe = 1 + 0.04 * Math.sin(performance.now() * 0.0012);
  ctx.globalAlpha = b.alpha;

  const wide = ctx.createRadialGradient(x, y, b.r * 0.8, x, y, b.r * 5.5 * breathe);
  wide.addColorStop(0, 'rgba(240,193,75,0.42)');
  wide.addColorStop(0.3, 'rgba(240,193,75,0.14)');
  wide.addColorStop(1, 'rgba(240,193,75,0)');
  ctx.fillStyle = wide;
  ctx.beginPath();
  ctx.arc(x, y, b.r * 5.5 * breathe, 0, FULL_CIRCLE);
  ctx.fill();

  const tight = ctx.createRadialGradient(x, y, b.r * 0.9, x, y, b.r * 1.9);
  tight.addColorStop(0, 'rgba(255,225,150,0.55)');
  tight.addColorStop(1, 'rgba(255,225,150,0)');
  ctx.fillStyle = tight;
  ctx.beginPath();
  ctx.arc(x, y, b.r * 1.9, 0, FULL_CIRCLE);
  ctx.fill();

  const disc = ctx.createRadialGradient(x, y, 0, x, y, b.r);
  disc.addColorStop(0, '#fff7dc');
  disc.addColorStop(0.55, '#f7d270');
  disc.addColorStop(1, '#d9902c');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, b.r, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.globalAlpha = 1;
  drawHot(ctx, b);
};

/**
 * A shaded sphere with a ring round it, the back half drawn before the body
 * and the front half after — which is the whole trick, and the reason this
 * cannot be two objects in the scene.
 */
export const ringed: BodyRenderer = (ctx, b) => {
  const half = (front: boolean): void => {
    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.translate(b.screen.x, b.screen.y);
    ctx.rotate(-0.35);
    ctx.strokeStyle = 'rgba(232,214,170,0.85)';
    ctx.lineWidth = Math.max(1, b.r * 0.32);
    ctx.beginPath();
    ctx.ellipse(0, 0, b.r * 1.95, b.r * 0.62, 0, front ? 0 : Math.PI, front ? Math.PI : 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
  };
  half(false);
  shaded(ctx, b);
  half(true);
};

/** Every renderer a document may name, by the name it names it with. */
const REGISTRY = new Map<string, BodyRenderer>([
  ['plain', plain],
  ['lit', lit],
  ['shaded', shaded],
  ['sun', sun],
  ['ringed', ringed],
]);

/** One line each, for the menu — what the name means, rather than what it
 * draws, which the preview already shows. */
const NOTES = new Map<string, string>([
  ['plain', 'A flat dot in the body’s own colour — Scene’s default.'],
  ['lit', 'A disc with a terminator, lit from the scene’s light source — for a body whose phase is the point.'],
  ['shaded', 'A little sphere: highlight toward the light, limb darkened. Reads as round even a few pixels across.'],
  ['sun', 'A corona and a bright disc — for the body everything else is lit by.'],
  ['ringed', 'A shaded sphere with a ring, drawn half behind it and half in front.'],
]);

/**
 * Add a renderer of the host's own under a name a document can use. The
 * emitted TypeScript will import that name from wherever the host says (see
 * `emit.ts`'s `rendererImport` option), so a figure built in the editor with a
 * project-specific renderer still compiles in the project.
 */
export function registerRenderer(name: string, renderer: BodyRenderer, note?: string): void {
  REGISTRY.set(name, renderer);
  if (note !== undefined) NOTES.set(name, note);
}

export function getRenderer(name: string): BodyRenderer | undefined {
  return REGISTRY.get(name);
}

export function rendererNames(): string[] {
  return [...REGISTRY.keys()];
}

export function rendererNote(name: string): string | undefined {
  return NOTES.get(name);
}
