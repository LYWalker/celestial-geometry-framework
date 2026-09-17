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

export * from './geometry';
export * from './camera';
export * from './annotate';
export * from './labels';
export * from './hover';
