/**
 * The diagram editor: build a figure by placing and adjusting it, then take it
 * away as ordinary TypeScript.
 *
 * Three layers, usable separately:
 *
 *  - `doc.ts` — the serialisable form of a figure. Plain JSON; no closures, no
 *    object identity, nothing that cannot be saved.
 *  - `compile.ts` / `emit.ts` — the round trip. A document compiles to live
 *    Scene objects, and emits as the source a hand-written figure would have
 *    been. Neither is the editor's private business: a build step can compile
 *    documents, and a script can emit them.
 *  - `editor.ts` — the UI over the two.
 *
 *   import { mountEditor } from 'celestial-geometry-framework/editor';
 *   mountEditor(document.querySelector('#editor')!, { examples: EXAMPLES });
 */

export * from './doc.js';
export * from './expr.js';
export * from './compile.js';
export * from './emit.js';
export * from './fields.js';
export * from './handles.js';
export * from './renderers.js';
export * from './state.js';
export * from './editor.js';
export * from './examples/index.js';
export * from './bodies.js';
