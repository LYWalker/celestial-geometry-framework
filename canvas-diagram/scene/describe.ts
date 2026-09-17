/**
 * The text alternative a canvas figure has no way to provide on its own.
 * Everything in a Scene is already named and, by this kit's convention,
 * described (`Meta.name`/`nameHe`/`description` — the same data the hover
 * tooltip surfaces visually), so the accessible version of a figure is a
 * derivation, not a second list to write and keep in sync:
 *
 *   describeSceneInto(objectListEl, scene);
 *
 * Call it after the scene is built, and again after anything that adds or
 * removes objects (the list is rebuilt, not appended to).
 */

import type { Scene, SceneItem } from './scene.js';

export interface SceneDescription {
  id: string;
  name: string;
  nameHe?: string | undefined;
  description?: string | undefined;
  /** the one line a list item would read: "Name: description", or just the
   * name for an object that has none */
  text: string;
}

export interface DescribeOptions {
  /** leave an object out — a construction line a reader doesn't need named,
   * say. Default: everything with a name. */
  filter?: (item: SceneItem) => boolean;
  /** include the Hebrew name in `text`. Default false: a screen reader
   * switching language mid-sentence is worse than leaving it to the visual
   * label, and `nameHe` is still on the record for a caller that wants it. */
  hebrew?: boolean;
}

/** Every named object in the scene, as plain data — for a list, a table, a
 * summary paragraph, or a test asserting the figure explains itself. */
export function describeScene(scene: Scene, opts: DescribeOptions = {}): SceneDescription[] {
  const out: SceneDescription[] = [];
  for (const item of scene.all()) {
    if (!item.name) continue;
    if (opts.filter && !opts.filter(item)) continue;
    const name = opts.hebrew && item.cfg.nameHe ? `${item.name} (${item.cfg.nameHe})` : item.name;
    out.push({
      id: item.id,
      name: item.name,
      nameHe: item.cfg.nameHe,
      description: item.cfg.description,
      text: item.cfg.description ? `${name}: ${item.cfg.description}` : name,
    });
  }
  return out;
}

/**
 * Fill a list element with that description — one `<li>` per object, the
 * element's previous contents replaced. Written with `textContent`, never
 * `innerHTML`: a description is authored prose, but it has no business
 * being parsed as markup.
 */
export function describeSceneInto(el: Element, scene: Scene, opts: DescribeOptions = {}): SceneDescription[] {
  const items = describeScene(scene, opts);
  el.replaceChildren();
  const doc = el.ownerDocument;
  for (const d of items) {
    const li = doc.createElement('li');
    li.textContent = d.text;
    el.appendChild(li);
  }
  return items;
}
