/**
 * A fixed reference point with a name — "the earth", "the mean sun" — that
 * other objects can centre on or point toward. It carries no geometry of its
 * own beyond a position, but it is a first-class, describable object so it
 * can be hovered and labelled exactly like a Sphere's carried body.
 */

import type { Vec } from '../geometry.js';
import { type Frame, type Meta, type PointLike, type Positioned, ORIGIN, SceneObject, resolvePoint } from './types.js';

export interface AnchorConfig extends Meta {
  /** where it sits — fixed, or itself riding another object. Default: the origin. */
  at?: PointLike;
  /** how to mark it on screen; 'none' for a point that exists only for other
   * objects to reference and should never itself be drawn */
  marker?: 'cross' | 'dot' | 'none';
  /** px radius of the drawn marker */
  dotSize?: number;
}

export class Anchor extends SceneObject<AnchorConfig> implements Positioned {
  readonly kind = 'anchor' as const;

  position(f: Frame): Vec {
    // Copied, not aliased — `at` may resolve to the frozen ORIGIN or to
    // another object's own returned Vec; see Sphere.centerAt's same fix.
    const p = resolvePoint(this.cfg.at ?? ORIGIN, f);
    return { x: p.x, y: p.y };
  }
}
