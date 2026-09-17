/**
 * The declarative layer on top of canvas-diagram's geometry/camera/annotate/
 * labels/hover primitives: define what a diagram *is* — spheres, the anchors
 * they're centred on, the angles, connectors and trails between them, each
 * with a name and a description — and Scene + Stage handle the trigonometry,
 * hit-testing, label layout, and default chrome (starfield, an optional
 * segmented ring, pan/zoom) that every figure in this style needs.
 *
 * A new figure's shape is usually:
 *
 *   const earth = new Anchor({ id: 'earth', name: 'The earth', marker: 'cross' });
 *   const sunShell = new Sphere({
 *     id: 'sun', name: 'The sun', nameHe: 'חמה', color: '#f0c14b',
 *     center: earth, radius: 120, eccentric: { ratio: 0.09, direction: 65 },
 *     speed: 360 / 365.25,
 *   });
 *   const scene = new Scene().add(earth).add(sunShell);
 *
 *   const stage = new Stage({ canvas, background: {...}, zodiac: {...} });
 *   stage.resize({ fitRadius: 140 });
 *   const hover = new HoverController({ root: tipEl, text: tipTextEl, sub: tipSubEl });
 *   let pointer: Vec | null = null;
 *   const cleanup = wireCamera({
 *     canvas, camera: stage.camera,
 *     minZoom: () => stage.fit * 0.4, maxZoom: () => stage.fit * 40,
 *     onChange: draw, onHover: (p) => { pointer = p; draw(); },
 *   });
 *
 *   function draw() {
 *     const f = frame(days); // or frame(days, { shellT, frameT }) for a diagram with UI-driven transitions
 *     stage.render({ scene, f, ref: earth, theme, hover, pointer });
 *   }
 *
 * No step in defining sunShell did any trigonometry — radius, how far
 * off-centre, and how fast it turns are the only numbers given, and
 * `sunShell.position(f)` (what actually gets drawn and hovered) is derived.
 */

export * from './types.js';
export * from './anchor.js';
export * from './sphere.js';
export * from './angle.js';
export * from './connector.js';
export * from './marker.js';
export * from './trail.js';
export * from './scene.js';
export * from './zodiac.js';
export * from './transitions.js';
export * from './selection.js';
export * from './describe.js';
export * from './stage.js';
