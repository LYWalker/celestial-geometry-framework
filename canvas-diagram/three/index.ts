/**
 * The three.js layer: for figures that have to be walked round.
 *
 * The 2D layer (`canvas-diagram/scene`) is the right tool whenever a figure
 * has a natural face-on view — it lays labels out against a fixed frame,
 * hit-tests exact circles, and lets `ctx.arc` do the drawing. What it cannot
 * do is move the viewpoint, and some constructions are only understood by
 * moving it. An inclination is the obvious one: seen face-on, a 5° tilt
 * projects to an ellipse 99.6% as wide as it is tall.
 *
 * So: three.js draws the geometry — perspective, a depth buffer, lighting —
 * and this layer supplies everything three has no opinion about. `Stage3D`
 * is the room (renderer, an orbiting z-up camera, the kit's own night sky and
 * vignette, themed from the same `background` object the 2D `Stage` takes).
 * `Annotator3D` is the part that makes it one of *these* figures: named
 * objects, collision-avoiding labels, hover-to-explain, and a text
 * alternative, on a 2D canvas stacked over the WebGL one.
 *
 * Meshes, materials and lights stay in three's own vocabulary. Wrapping them
 * would only mean an author learning two scene graphs instead of one.
 *
 * This entry point needs `three` as a peer dependency. The rest of the kit
 * has no dependencies at all, and importing `canvas-diagram` or
 * `canvas-diagram/scene` does not pull three in.
 */

export * from './annotate3d.js';
export * from './stage3d.js';
export * from './objects3d.js';
export * from './textures.js';
