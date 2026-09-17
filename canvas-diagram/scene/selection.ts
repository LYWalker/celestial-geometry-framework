/**
 * "Click a body to follow it" — the small amount of state every figure in
 * this kit ends up keeping around a `Scene.hitTest()`: what's selected, what
 * a click does to that (pick, or pick again to let go), and which point the
 * camera should hold still as a result.
 *
 * A figure wires it to the pointer and reads `ref()` where it used to read
 * its own fallback point:
 *
 *   const following = new Selection({ scene, fallback: earth });
 *   wireCamera({ ..., onClick: (p) => {
 *     following.clickAt(p, { f: currentFrame(), ref: following.ref(), camera: stage.camera });
 *     draw();
 *   }});
 *   stage.render({ scene, f, ref: following.ref(), ... });
 *
 * Only things that *have* a position can be followed, so clicking an Angle
 * or a Connector selects nothing and leaves whatever was selected alone —
 * the same judgement `hitTest()` already makes about what is a target.
 */

import type { Vec } from '../geometry.js';
import type { Camera } from '../camera.js';
import type { Scene, SceneItem } from './scene.js';
import type { Frame, PointLike, Positioned } from './types.js';

export interface SelectionOptions {
  scene: Scene;
  /** what `ref()` returns when nothing is selected — the point the figure
   * is centred on by default */
  fallback: PointLike;
  /** fires when the selection actually changes (not on a click that lands
   * on the same thing, and not on a click that hits nothing) */
  onChange?: (item: SceneItem | null) => void;
  /** clicking what's already selected lets go of it. Default true. */
  toggle?: boolean;
  /** which objects may be followed at all — a figure whose "follow" UI only
   * makes sense for its bodies (it names the thing being followed, say)
   * says so here, rather than discovering later that a shell got selected
   * and half the UI has nothing to show for it. Default: anything with a
   * position. A click on something excluded is reported back as a hit, but
   * changes nothing. */
  selectable?: (item: SceneItem) => boolean;
}

/** Everything in a Scene that can be followed has a position; Angles and
 * Connectors don't, so they're never selected. */
function positionOf(item: SceneItem | null): (SceneItem & Positioned) | null {
  return item && typeof (item as Partial<Positioned>).position === 'function' ? (item as SceneItem & Positioned) : null;
}

export class Selection {
  private current: (SceneItem & Positioned) | null = null;

  constructor(private opts: SelectionOptions) {}

  /** The selected object, or null. */
  get item(): SceneItem | null {
    return this.current;
  }

  /** Its id, or null — the form a figure's own UI state usually wants. */
  get id(): string | null {
    return this.current?.id ?? null;
  }

  /** What the draw call should hold still: whatever is selected, else the
   * fallback. Pass it straight to `stage.render({ ref })`. */
  ref(): PointLike {
    return this.current ?? this.opts.fallback;
  }

  /** Select by id (or null to clear). Unknown ids, and objects with no
   * position of their own, clear the selection rather than throwing — this
   * is UI state restored from a URL or a button, not a scene lookup. */
  select(id: string | null): SceneItem | null {
    const found = id !== null && this.opts.scene.has(id) ? positionOf(this.opts.scene.get(id)) : null;
    const next = found && (this.opts.selectable?.(found) ?? true) ? found : null;
    if (next === this.current) return this.current;
    this.current = next;
    this.opts.onChange?.(next);
    return next;
  }

  /**
   * Resolve a click: hit-test the scene, and select what it found — or, if
   * that's already what's selected, let go of it (unless `toggle: false`).
   * A click on empty space leaves the selection as it was, which is what
   * makes "click a body to follow it" survive a stray click on the sky;
   * pass `clearOnMiss: true` for the other convention.
   *
   * Returns whatever was hit, so a caller can flash a message about it
   * without hit-testing a second time.
   */
  clickAt(
    screenPt: Vec,
    opts: { f: Frame; ref: PointLike; camera: Camera; threshold?: number; clearOnMiss?: boolean },
  ): SceneItem | null {
    const hit = this.opts.scene.hitTest(screenPt, opts);
    if (!hit) {
      if (opts.clearOnMiss) this.select(null);
      return null;
    }
    const target = positionOf(hit);
    if (!target || !(this.opts.selectable?.(target) ?? true)) return hit;
    if (target === this.current && (this.opts.toggle ?? true)) this.select(null);
    else this.select(target.id);
    return hit;
  }
}
