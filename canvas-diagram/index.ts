/**
 * A small kit for interactive canvas figures in the Kiddush HaChodesh /
 * Yesodei haTorah style: a camera you can pan and zoom, angle constructions
 * (sweep an arc, mark it), a label layout engine that keeps names from
 * piling up, and "hover a line and it explains itself." Orrery.astro is the
 * first consumer and proves the API; see it for the pattern a new figure
 * should follow — a `mark()` that both pushes a Label and calls
 * hover.mark(), a `draw()` that calls hover.update()/drawHighlight() once a
 * frame, pointer handlers that feed camera.zoomAt()/panBy().
 */

export * from './geometry.js';
export * from './camera.js';
export * from './annotate.js';
export * from './labels.js';
export * from './hover.js';

// The declarative scene layer (Sphere/Anchor/Angle/Connector/Trail, Scene,
// Stage) built on top of the primitives above — re-exported so a consumer
// only needs this one import path rather than also reaching into
// `./scene/index.js`. Checked for name collisions against the barrel above
// (none, as of this export: the two layers' public names don't overlap) —
// a genuine collision here would silently shadow one export with the
// other, so if you're adding a new top-level export to either layer, run
// that check again rather than assuming.
export * from './scene/index.js';
