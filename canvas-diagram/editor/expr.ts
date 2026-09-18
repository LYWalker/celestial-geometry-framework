/**
 * Turning an `{ expr }` from a document back into the closure the scene layer
 * wants, and doing it in a way an editor can survive.
 *
 * The scene layer's whole flexibility rests on closures: `angle: (f) => f.t *
 * 22`, `radius: (f) => lerp(a, b, f.scaleT)`, `lonOffset: (f) =>
 * PRECESSION_DEG_PER_DAY * f.t`. A document stores those as source text, which
 * means something here has to evaluate source text. That is a real decision,
 * so it is worth stating what it is and is not:
 *
 * This is an *authoring* tool. The source being evaluated is the source the
 * author just typed into the inspector, in their own browser, and the emitted
 * TypeScript contains the same text, compiled by their own build. There is no
 * trust boundary between the typist and the evaluator — it is the same person,
 * one keystroke apart. What there emphatically is, is a *fragility* boundary:
 * a half-typed expression must not take the figure down, and a thrown error on
 * frame 900 must not throw again on every frame after it. So the work here is
 * not sandboxing (which would be theatre — the expression is meant to reach
 * the figure's own helpers), it is containment: compile once, cache, catch,
 * latch the failure, keep drawing.
 *
 * Three things make that work:
 *
 *  - **Compile once per source string.** `new Function` is not cheap and a
 *    figure re-reads every Scalar every frame. The cache is keyed on the text
 *    *and* the scope's version, so adding an object (which adds a name to
 *    scope) rebuilds, and nothing else does.
 *  - **Latch runtime failures.** A Scalar that throws is reported once and
 *    then returns its fallback forever, rather than filling the console at
 *    60fps with the same stack. `Env.reset()` (which the editor calls on every
 *    edit) is what un-latches it, so fixing the expression fixes the figure.
 *  - **Name the scope explicitly.** Helpers are destructured into the
 *    function's own parameters rather than reached through `with` or the
 *    global object, so an expression that reads an undefined name fails at
 *    compile time with that name in the message, instead of reading
 *    `undefined` off `globalThis` and propagating a silent `NaN` into a
 *    position that simply stops appearing.
 */

import { DEG, add, clamp, dot, lonOf, norm360, polar, sub, unit, type Vec } from '../geometry.js';
import { bearingFrom, distanceBetween, type Frame, type PointLike } from '../scene/types.js';

/** What an expression can reach besides `f`. */
export type Helpers = Record<string, unknown>;

/**
 * The helpers every figure's expressions get without asking: this kit's own
 * geometry, and the two or three arithmetic shapes that otherwise get
 * rewritten by hand in every figure.
 *
 * `Math` is deliberately absent — it is a global, and an expression reaches it
 * the ordinary way. What is here is everything that is *not* reachable from a
 * bare function body: the kit's exports.
 */
/** The straight blend every transition amount is spent on. */
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** The eased one — smoothstep, for a mode change that should not start and
 * stop abruptly. */
export const ease = (k: number): number => {
  const x = clamp(k, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Degrees, wrapped to (-180, 180] — the form a *correction* is read in, as
 * against a place, which is read in [0, 360). */
export const wrap180 = (deg: number): number => {
  const x = norm360(deg);
  return x > 180 ? x - 360 : x;
};

/**
 * These three are exported as ordinary functions, not only put in this object,
 * because an expression that uses one has to keep working after it leaves the
 * editor: `emit.ts` notices the name and imports it from here, exactly as it
 * imports `polar` from the kit. A helper reachable only through this table
 * would be a helper that compiles in the editor and not in the file it emits.
 */
export const BASE_HELPERS: Helpers = {
  DEG,
  polar,
  lonOf,
  norm360,
  clamp,
  unit,
  sub,
  add,
  dot,
  distanceBetween,
  bearingFrom,
  lerp,
  ease,
  wrap180,
};

/** What went wrong, and where — carried back to the editor so a bad
 * expression is shown on the field that holds it rather than in the console. */
export interface ExprProblem {
  /** the object the expression belongs to */
  id: string;
  /** the field it sits in, dotted for a nested one: `eccentric.direction` */
  field: string;
  source: string;
  message: string;
  /** true when it compiled but threw while drawing */
  runtime?: boolean;
}

/**
 * The scope a figure's expressions are compiled against, and the cache of what
 * has already been compiled against it.
 *
 * One of these belongs to one editor (or one compiled figure). It holds three
 * layers of names, in increasing specificity: the base helpers above, whatever
 * the host registered (`rambam`, an ephemeris, a palette — see
 * `registerHelpers`), and the figure's own objects, added by `compile.ts` so
 * an expression can say `distanceBetween(earth, moon, f)` using the same names
 * the emitted TypeScript will.
 */
export class Env {
  private helpers: Helpers = { ...BASE_HELPERS };
  private cache = new Map<string, CompiledEntry>();
  /** value expressions are cached apart from frame expressions rather than
   * under a prefixed key: the two are compiled the same way but consumed
   * differently, and one keyspace would need a separator no source string can
   * contain, which is a promise about source strings worth not making */
  private valueCache = new Map<string, CompiledEntry>();
  /** bumped whenever the set of names changes, to invalidate the cache */
  private version = 0;
  private problems: ExprProblem[] = [];

  /**
   * Add names an expression may use. Called by the host for a figure that
   * needs its own domain functions — the Rambam figures pass their ephemeris
   * in this way, so `angle: { expr: 'rambam.sun(f.t).mean' }` works in the
   * editor and emits as the same call against a real import.
   */
  registerHelpers(more: Helpers): void {
    Object.assign(this.helpers, more);
    this.invalidate();
  }

  /** The names currently in scope, for the inspector's autocomplete and for
   * the "what can I write here" hint under an expression field. */
  names(): string[] {
    return Object.keys(this.helpers).sort();
  }

  /** Drop every compiled function. Called when a name is added or removed,
   * and by the editor after any edit — which is also what clears a latched
   * runtime failure, so correcting an expression brings its object back. */
  invalidate(): void {
    this.version++;
    this.cache.clear();
    this.valueCache.clear();
    this.problems = [];
  }

  /** Every problem seen since the last `invalidate()`. */
  allProblems(): readonly ExprProblem[] {
    return this.problems;
  }

  private note(p: ExprProblem): void {
    this.problems.push(p);
  }

  /**
   * Compile `source` into a function of the frame returning `T`, or report why
   * it could not be and hand back a function returning `fallback`.
   *
   * The returned function never throws: a runtime failure is reported once
   * (through `onProblem`, and into this Env's own list) and the fallback is
   * returned from then on. That is what lets an editor keep a figure on screen
   * while an expression is half-typed, which is most of the time an expression
   * is being typed at all.
   */
  compile<T>(source: string, where: { id: string; field: string }, fallback: T): (f: Frame) => T {
    const key = `${this.version}:${source}`;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = this.build(source, where);
      this.cache.set(key, entry);
    }
    if (entry.error !== undefined) {
      this.note({ ...where, source, message: entry.error });
      return () => fallback;
    }
    const fn = entry.fn;
    // `failed` is per compiled entry, not per field: the same source text
    // reused by two objects has the same bug and is worth reporting once.
    return (f: Frame): T => {
      if (entry.failed) return fallback;
      try {
        return fn(f) as T;
      } catch (e) {
        entry.failed = true;
        this.note({ ...where, source, message: (e as Error).message, runtime: true });
        return fallback;
      }
    };
  }

  /**
   * Compile `source` into a plain value rather than a function of the frame —
   * for the handful of fields that are a function of something *else*
   * (`Angle.format`, which takes degrees; `Sphere.render`, which is a canvas
   * routine). The expression's own text is the whole value, so
   * `(d) => \`${d.toFixed(0)}'\`` evaluates to exactly that function.
   */
  compileValue<T>(source: string, where: { id: string; field: string }, fallback: T): T {
    const key = `${this.version}:${source}`;
    let entry = this.valueCache.get(key);
    if (!entry) {
      entry = this.build(source, where);
      this.valueCache.set(key, entry);
    }
    if (entry.error !== undefined) {
      this.note({ ...where, source, message: entry.error });
      return fallback;
    }
    try {
      // A value expression is evaluated once, with no frame — anything it
      // reads off `f` is a mistake, and reads as undefined rather than
      // silently capturing some other moment's frame.
      return entry.fn(undefined as unknown as Frame) as T;
    } catch (e) {
      this.note({ ...where, source, message: (e as Error).message, runtime: true });
      return fallback;
    }
  }

  private build(source: string, where: { id: string; field: string }): CompiledEntry {
    const names = Object.keys(this.helpers);
    const values = names.map((n) => this.helpers[n]);
    try {
      // Destructured into named parameters rather than reached through `with`
      // or the globals: an expression that misspells a helper then fails here,
      // naming it, instead of reading undefined off globalThis at draw time.
      const factory = new Function(...names, `"use strict"; return (f) => (${source});`) as (
        ...args: unknown[]
      ) => (f: Frame) => unknown;
      const fn = factory(...values);
      return { fn, failed: false };
    } catch (e) {
      return {
        fn: () => undefined,
        failed: true,
        error: `${(e as Error).message} — in \`${where.field}\` of "${where.id}"`,
      };
    }
  }
}

interface CompiledEntry {
  fn: (f: Frame) => unknown;
  /** set once this entry has thrown, so it is not called again */
  failed: boolean;
  /** set when it never compiled at all */
  error?: string;
}

/**
 * A `PointLike` an expression can be handed under an object's own name.
 *
 * The figure's objects are put in scope so an expression can say
 * `distanceBetween(earth, moon, f)` — but the objects do not exist yet when
 * the first of them is compiled, and one of them may be the very object whose
 * expression is being compiled. So what goes into scope is not the object but
 * a stand-in that looks it up when asked, which is at draw time, by which
 * point every object exists. It is the same late binding a module-level `const
 * moon` gives the hand-written figure, arrived at the only way a builder can.
 *
 * The lookup is typed loosely on purpose. Not every scene object *has* a
 * place: an Angle is a quantity and a Connector is a line between two things
 * that do, and neither implements `Positioned`. The editor only offers the
 * kinds that do when a reference is being picked, but a hand-written document
 * can still name one, and the honest answer for "where is that angle" is the
 * origin rather than a crash halfway through a frame.
 */
export function lateRef(lookup: () => unknown): PointLike {
  const base = {
    position(f: Frame): Vec {
      const target = lookup();
      if (target === null || target === undefined) return { x: 0, y: 0 };
      if (typeof target === 'function') return (target as (f: Frame) => Vec)(f);
      if (typeof target === 'object' && 'position' in target) {
        return (target as { position: (f: Frame) => Vec }).position(f);
      }
      if (typeof target === 'object' && 'x' in target && 'y' in target) return target as Vec;
      return { x: 0, y: 0 };
    },
  };

  // Everything *else* the object has, forwarded.
  //
  // A figure's expressions do not only ask where something is. They ask where
  // a circle's own centre is (`deferent.centerAt(f)` — not the same as its
  // position, which is the point it carries), how big it currently is
  // (`radiusAt`), what an angle currently reads (`valueAt`). A stand-in that
  // offered only `position` would leave those unsayable in the editor while
  // remaining perfectly ordinary in hand-written source — and the whole claim
  // this editor rests on is that the two say the same things. So the stand-in
  // forwards every other property to the object it names, binding methods to
  // it, and `position` stays the one the base object answers itself, since
  // that is the one that has to work before the object exists.
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'position') return Reflect.get(target, prop, receiver);
      const object = lookup();
      if (object === null || typeof object !== 'object') return undefined;
      const value = Reflect.get(object, prop) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(object) : value;
    },
    has(_target, prop) {
      if (prop === 'position') return true;
      const object = lookup();
      return typeof object === 'object' && object !== null && prop in object;
    },
  }) as PointLike;
}
