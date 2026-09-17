/**
 * Canvas-drawn textures for the three.js layer.
 *
 * Both of these could in principle be geometry instead — a grid of lines, a
 * ring of triangles — and both are much better as a texture. A grid of lines
 * lying exactly in the plane it marks z-fights with that plane at grazing
 * angles, which is most angles in a figure you can walk round, and lines
 * cannot fade along their own length without being split into segments. Drawn
 * into a texture instead, the fade is free, the filtering antialiases them,
 * and there is one surface for the depth sort to think about rather than
 * dozens.
 */

import * as THREE from 'three';

/** Pull `r,g,b` out of any CSS colour three can parse, so a caller can hand
 * these helpers the same theme string it hands everything else and get
 * translucent variants of it back. */
function rgb(color: string): [number, number, number] {
  const c = new THREE.Color(color);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

export interface PlaneGridOptions {
  /** the plane's colour; every stop below is this colour at some alpha */
  color: string;
  /** concentric circles, not counting the centre. Default 6. */
  rings?: number;
  /** radial spokes. Default 24. */
  spokes?: number;
  /** alpha at the centre of the fill. Default 0.2. */
  fill?: number;
  /** alpha of the grid lines at the centre. Default 0.34. */
  lines?: number;
  /** texture size in px, square. Default 1024. */
  size?: number;
}

/**
 * A reference plane: a fill that fades out toward the rim, concentric rings
 * and spokes that fade with it.
 *
 * Map it onto a `CircleGeometry` rather larger than the thing being measured,
 * with `transparent: true` and `depthWrite: false`. Because it fades rather
 * than ending, the plane reads as carrying on past the edge of the picture,
 * which for an ecliptic or an equator is the truth.
 */
export function planeGrid(opts: PlaneGridOptions): THREE.CanvasTexture {
  const S = opts.size ?? 1024;
  const rings = opts.rings ?? 6;
  const spokes = opts.spokes ?? 24;
  const fillA = opts.fill ?? 0.2;
  const lineA = opts.lines ?? 0.34;
  const [r, g, b] = rgb(opts.color);
  const rgba = (a: number) => `rgba(${r},${g},${b},${a.toFixed(3)})`;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const mid = S / 2;
  const R = S / 2;

  const fill = ctx.createRadialGradient(mid, mid, 0, mid, mid, R);
  fill.addColorStop(0, rgba(fillA));
  fill.addColorStop(0.55, rgba(fillA * 0.5));
  fill.addColorStop(1, rgba(0));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(mid, mid, R, 0, Math.PI * 2);
  ctx.fill();

  // everything below fades on the same curve as the fill, so the grid stops
  // where the plane stops rather than ending on a hard edge
  const fade = (t: number) => Math.max(0, 1 - t * t);

  ctx.lineWidth = 2;
  for (let k = 1; k <= rings; k++) {
    const t = k / (rings + 0.4);
    ctx.strokeStyle = rgba(lineA * fade(t));
    ctx.beginPath();
    ctx.arc(mid, mid, R * t, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const grad = ctx.createLinearGradient(mid, mid, mid + Math.cos(a) * R, mid + Math.sin(a) * R);
    grad.addColorStop(0, rgba(lineA * 0.88));
    grad.addColorStop(0.7, rgba(lineA * 0.3));
    grad.addColorStop(1, rgba(0));
    ctx.strokeStyle = grad;
    // every fourth spoke a little stronger, so the plane has a readable
    // grain rather than an even hatch
    ctx.lineWidth = i % 4 === 0 ? 2.6 : 1.4;
    ctx.beginPath();
    ctx.moveTo(mid + Math.cos(a) * R * 0.05, mid + Math.sin(a) * R * 0.05);
    ctx.lineTo(mid + Math.cos(a) * R, mid + Math.sin(a) * R);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export interface GlowOptions {
  /** the hot centre */
  inner: string;
  /** the colour it falls off through */
  outer: string;
  /** how far out the hot centre reaches, 0-1. Default 0.22. */
  core?: number;
  size?: number;
}

/**
 * A soft round glow, for a corona or a halo. Use on a `Sprite` with
 * `AdditiveBlending` and `depthWrite: false` — additive because light adds,
 * and no depth write because a glow should never occlude what is behind it.
 */
export function glow(opts: GlowOptions): THREE.CanvasTexture {
  const S = opts.size ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const [r, g, b] = rgb(opts.outer);
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, opts.inner);
  grad.addColorStop(opts.core ?? 0.22, opts.outer);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
