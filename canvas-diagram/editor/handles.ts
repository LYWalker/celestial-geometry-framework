/**
 * Dragging the figure itself.
 *
 * Numbers in a panel are exact and unreadable. Nobody knows what a radius of
 * 34 looks like, or which way 200° points, and finding out by typing numbers
 * and watching is a slow way to build anything. So the selected object grows
 * handles on the canvas, and the ones that matter are the ones that correspond
 * to something the figure *means*: a sphere's rim, the point riding it, how
 * far its own centre sits off the thing it is centred on.
 *
 * Every handle is the same three things — where it sits this frame, what it is
 * called, and what a drag to a world point does to the document. That last is
 * an ordinary edit, coalesced so one drag is one undo step, which is why there
 * is no separate "live drag" state anywhere: the document is edited on every
 * pointer move and the figure recompiles, exactly as if the number had been
 * typed. What you drag is what gets saved.
 *
 * A handle appears only where the document can actually take the change. A
 * sphere centred on another object has no centre handle, because its centre is
 * not a number it holds — it is wherever that object is, and dragging it would
 * have to mean something else. A radius written as an expression has no rim
 * handle, because the rim is a consequence of the expression rather than a
 * value. Offering a handle that silently does nothing is worse than offering
 * none, so the rule is: a handle exists exactly when the field behind it is a
 * plain number this drag can set.
 */

import { lonOf, norm360, polar, sub, type Vec } from '../geometry.js';
import { Angle } from '../scene/angle.js';
import { Anchor } from '../scene/anchor.js';
import { Connector } from '../scene/connector.js';
import { RingMarker } from '../scene/marker.js';
import { Sphere } from '../scene/sphere.js';
import { resolvePoint, type Frame } from '../scene/types.js';
import type { CompiledFigure } from './compile.js';
import { isXY, type ObjectDoc, type SphereDoc } from './doc.js';
import { setPath, type EditorState } from './state.js';

export interface Handle {
  /** unique within the object, so a drag in progress can be identified */
  id: string;
  /** where it sits this frame, in world space */
  at: Vec;
  /** shown while the pointer is over it */
  label: string;
  /** a round handle moves a point; a square one sets a distance; a diamond
   * sets an angle. Three shapes, so what a handle will do is legible before
   * it is touched. */
  shape: 'round' | 'square' | 'diamond';
  /** apply a drag that has reached `world` */
  drag(world: Vec, state: EditorState): void;
}

/** How close, in screen px, the pointer has to be to grab a handle. */
export const HANDLE_GRAB_PX = 10;
/** How big they are drawn, screen px. */
export const HANDLE_SIZE_PX = 4.5;

/**
 * The handles for one object at this moment. Returns none for an object that
 * is not in the scene (one that failed to compile), since there is nothing to
 * hang them off.
 */
export function handlesFor(o: ObjectDoc, fig: CompiledFigure, f: Frame): Handle[] {
  const item = fig.items.get(o.id);
  if (!item) return [];
  const out: Handle[] = [];

  const editNumber = (path: string, value: number, coalesce: string): ((state: EditorState) => void) =>
    (state: EditorState) =>
      state.edit(
        (doc) => {
          const target = doc.objects.find((x) => x.id === o.id);
          if (!target) return false;
          setPath(target as unknown as Record<string, unknown>, path, round(value));
        },
        { label: path, coalesce },
      );

  if (item instanceof Anchor && o.kind === 'anchor') {
    // A fixed anchor is the one thing in a figure that is purely a place, so
    // it drags freely. One riding another object does not: its place is that
    // object's, and moving it would have to move something else.
    if (o.at === undefined || isXY(o.at)) {
      out.push({
        id: 'at',
        at: item.position(f),
        label: `${o.name} — drag to move it`,
        shape: 'round',
        drag: (world, state) =>
          state.edit(
            (doc) => {
              const target = doc.objects.find((x) => x.id === o.id);
              if (!target) return false;
              setPath(target as unknown as Record<string, unknown>, 'at', { x: round(world.x), y: round(world.y) });
            },
            { label: 'move', coalesce: `${o.id}:at` },
          ),
      });
    }
  }

  if (item instanceof Sphere && o.kind === 'sphere') {
    const center = item.centerAt(f);
    const radius = item.radiusAt(f);

    // The rim. Placed up and to the right of the centre rather than at 0°, so
    // it does not sit under the carried body of a sphere whose phase is zero.
    if (typeof o.radius === 'number') {
      const at = { x: center.x + polar(45, radius).x, y: center.y + polar(45, radius).y };
      out.push({
        id: 'radius',
        at,
        label: `radius ${radius.toFixed(0)} — drag the rim`,
        shape: 'square',
        drag: (world, state) => editNumber('radius', Math.hypot(world.x - center.x, world.y - center.y), `${o.id}:radius`)(state),
      });
    }

    // The centre. Two quite different meanings, and which one applies is
    // exactly the question of whether this circle is off-centre from what it
    // is centred on.
    if (o.eccentric !== undefined && typeof o.eccentric.ratio === 'number' && typeof o.eccentric.direction === 'number') {
      const parent = resolvePoint(item.cfg.center ?? { x: 0, y: 0 }, f);
      out.push({
        id: 'eccentric',
        at: center,
        label: `off-centre by ${(o.eccentric.ratio * 100).toFixed(0)}% of its radius — drag it`,
        shape: 'round',
        drag: (world, state) => {
          const offset = sub(world, parent);
          const ratio = radius > 0 ? Math.hypot(offset.x, offset.y) / radius : 0;
          state.edit(
            (doc) => {
              const target = doc.objects.find((x) => x.id === o.id) as SphereDoc | undefined;
              if (!target?.eccentric) return false;
              target.eccentric.ratio = round(Math.min(ratio, 1));
              target.eccentric.direction = round(norm360(lonOf(offset)));
            },
            { label: 'off-centre', coalesce: `${o.id}:ecc` },
          );
        },
      });
    } else if (o.center === undefined || isXY(o.center)) {
      out.push({
        id: 'center',
        at: center,
        label: 'drag to move this circle',
        shape: 'round',
        drag: (world, state) =>
          state.edit(
            (doc) => {
              const target = doc.objects.find((x) => x.id === o.id);
              if (!target) return false;
              setPath(target as unknown as Record<string, unknown>, 'center', { x: round(world.x), y: round(world.y) });
            },
            { label: 'move', coalesce: `${o.id}:center` },
          ),
      });
    }

    // The body riding the rim. Dragging it sets where it stands — which is
    // `angle` for a body given its bearing outright, and `phase` for one
    // turning at a rate, since for that one "where it is now" is a
    // consequence of where it started.
    if (item.showBody) {
      const bearing = item.angleAt(f);
      const settable = typeof o.angle === 'number' || (o.angle === undefined && typeof (o.speed ?? 0) === 'number');
      if (settable) {
        out.push({
          id: 'body',
          at: item.position(f),
          label:
            o.angle !== undefined
              ? `at ${bearing.toFixed(1)}° — drag to set its angle`
              : `drag to set where it stands when the clock reads zero`,
          shape: 'diamond',
          drag: (world, state) => {
            // Measured from wherever the angle is actually counted from, so a
            // sphere with `measureFrom` set (the Rambam's moon, counted from
            // the earth) drags to the bearing the figure means, not to one
            // taken from a centre the construction never uses.
            const from = item.cfg.measureFrom !== undefined ? resolvePoint(item.cfg.measureFrom, f) : center;
            const want = norm360(lonOf(sub(world, from)));
            if (o.angle !== undefined) editNumber('angle', want, `${o.id}:angle`)(state);
            else editNumber('phase', norm360(want - (o.speed ?? 0) * f.t), `${o.id}:phase`)(state);
          },
        });
      }
    }
  }

  if (item instanceof Angle && o.kind === 'angle') {
    const vertex = item.vertexAt(f);
    if (isXY(o.vertex)) {
      out.push({
        id: 'vertex',
        at: vertex,
        label: 'drag the vertex',
        shape: 'round',
        drag: (world, state) =>
          state.edit(
            (doc) => {
              const target = doc.objects.find((x) => x.id === o.id);
              if (!target) return false;
              setPath(target as unknown as Record<string, unknown>, 'vertex', { x: round(world.x), y: round(world.y) });
            },
            { label: 'move', coalesce: `${o.id}:vertex` },
          ),
      });
    }
    if (typeof o.radius === 'number') {
      const mid = item.midAt(f);
      out.push({
        id: 'radius',
        at: mid,
        label: `arc radius ${item.radiusAt(f).toFixed(0)} — drag it out`,
        shape: 'square',
        drag: (world, state) => editNumber('radius', Math.hypot(world.x - vertex.x, world.y - vertex.y), `${o.id}:radius`)(state),
      });
    }
    // The two arms, when either is a plain bearing rather than an object it
    // sights at — an angle drawn between two given directions is exactly the
    // case where dragging beats typing.
    for (const arm of ['from', 'to'] as const) {
      const value = o[arm];
      if (typeof value !== 'number') continue;
      const r = item.radiusAt(f);
      const d = polar(value, r * 1.15);
      out.push({
        id: arm,
        at: { x: vertex.x + d.x, y: vertex.y + d.y },
        label: `${arm} ${value.toFixed(1)}° — drag the arm`,
        shape: 'diamond',
        drag: (world, state) => editNumber(arm, norm360(lonOf(sub(world, vertex))), `${o.id}:${arm}`)(state),
      });
    }
  }

  if (item instanceof Connector && o.kind === 'connector') {
    if (isXY(o.from)) {
      out.push({
        id: 'from',
        at: item.fromAt(f),
        label: 'drag this end',
        shape: 'round',
        drag: (world, state) =>
          state.edit(
            (doc) => {
              const target = doc.objects.find((x) => x.id === o.id);
              if (!target) return false;
              setPath(target as unknown as Record<string, unknown>, 'from', { x: round(world.x), y: round(world.y) });
            },
            { label: 'move', coalesce: `${o.id}:from` },
          ),
      });
    }
    if (o.to === undefined && typeof o.toward === 'number' && typeof (o.length ?? 0) === 'number') {
      // A sightline: one handle sets both its bearing and how far it reaches,
      // because those are the two halves of one gesture — pointing.
      const start = item.fromAt(f);
      out.push({
        id: 'tip',
        at: item.toAt(f),
        label: 'drag to aim this sightline and set how far it reaches',
        shape: 'diamond',
        drag: (world, state) => {
          const offset = sub(world, start);
          state.edit(
            (doc) => {
              const target = doc.objects.find((x) => x.id === o.id);
              if (!target || target.kind !== 'connector') return false;
              target.toward = round(norm360(lonOf(offset)));
              target.length = round(Math.hypot(offset.x, offset.y));
            },
            { label: 'aim', coalesce: `${o.id}:tip` },
          );
        },
      });
    } else if (isXY(o.to)) {
      out.push({
        id: 'to',
        at: item.toAt(f),
        label: 'drag this end',
        shape: 'round',
        drag: (world, state) =>
          state.edit(
            (doc) => {
              const target = doc.objects.find((x) => x.id === o.id);
              if (!target) return false;
              setPath(target as unknown as Record<string, unknown>, 'to', { x: round(world.x), y: round(world.y) });
            },
            { label: 'move', coalesce: `${o.id}:to` },
          ),
      });
    }
  }

  if (item instanceof RingMarker && o.kind === 'ringmarker') {
    const center = item.centerAt(f);
    if (typeof o.toward === 'number') {
      out.push({
        id: 'toward',
        at: item.position(f),
        label: `reading ${o.toward.toFixed(1)}° — drag it round the ring`,
        shape: 'diamond',
        drag: (world, state) => editNumber('toward', norm360(lonOf(sub(world, center))), `${o.id}:toward`)(state),
      });
    }
    if (typeof o.radius === 'number') {
      const d = polar(typeof o.toward === 'number' ? o.toward + 12 : 12, o.radius);
      out.push({
        id: 'radius',
        at: { x: center.x + d.x, y: center.y + d.y },
        label: 'drag to set which circle it reads against',
        shape: 'square',
        drag: (world, state) => editNumber('radius', Math.hypot(world.x - center.x, world.y - center.y), `${o.id}:radius`)(state),
      });
    }
  }

  return out;
}

/** World px to a tenth. A drag produces a float per pixel of pointer travel,
 * and a document full of `33.99999999999999` is a document nobody wants to
 * read the diff of. A tenth of a world pixel is well under what any of these
 * figures can show. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}
