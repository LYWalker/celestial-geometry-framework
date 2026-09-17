/**
 * The named, eased values a figure's Frame is built from — "the view is
 * sliding from heliocentric to geocentric," "the shells are fading in,"
 * "distances are moving to their true proportions" — in one object, instead
 * of a `uiState`/`targets` pair and a hand-written exponential approach in
 * every figure's own tick().
 *
 * A figure declares what it has, sets targets from its UI, advances them by
 * the frame's elapsed time, and asks for a Frame:
 *
 *   const t = new Transitions({ shellT: 0, frameT: 0, scaleT: 0 });
 *   modeBtn.onclick = () => t.set({ frameT: 1 });
 *   ...
 *   t.advance(dt);
 *   stage.render({ scene, f: t.frame(days), ... });
 *
 * The easing is the same exponential approach those figures wrote by hand —
 * framerate-independent, since it's `1 - rate^dt` rather than a fixed step
 * per frame — and it *settles*: once a value is within `epsilon` of its
 * target it snaps and stops, so `advance()` reports whether anything is
 * still moving and a figure can stop redrawing when nothing is.
 *
 * Nothing here knows about time itself: `frame(t)` takes the diagram's own
 * clock, exactly as `frame()` does, and only supplies the other keys.
 */

import { frame, type Frame } from './types.js';

export interface TransitionOptions {
  /**
   * how much of the remaining distance is left after one second — 0.0001
   * (the default) is "essentially there in a second," which is the feel
   * both Rambam figures were tuned to. Larger is slower, smaller snappier.
   */
  rate?: number;
  /** how close counts as arrived, in the value's own units. Default 0.0005 —
   * well under a pixel or a percent for the 0..1 amounts these usually are. */
  epsilon?: number;
}

export class Transitions {
  private current: Record<string, number>;
  private targets: Record<string, number>;
  private readonly rate: number;
  private readonly epsilon: number;

  constructor(initial: Record<string, number>, opts: TransitionOptions = {}) {
    this.current = { ...initial };
    this.targets = { ...initial };
    this.rate = opts.rate ?? 0.0001;
    this.epsilon = opts.epsilon ?? 0.0005;
  }

  /** Where a value is right now. Unknown keys read 0, the same way a Frame's
   * own missing key would — declare what you use in the constructor. */
  get(key: string): number {
    return this.current[key] ?? 0;
  }

  /** Where a value is heading — what the UI last asked for, which is what a
   * button's pressed state should reflect, not the mid-flight value. */
  target(key: string): number {
    return this.targets[key] ?? 0;
  }

  /** Ease one or more values toward new targets. */
  set(targets: Record<string, number>): this {
    Object.assign(this.targets, targets);
    return this;
  }

  /** Put values *at* a target immediately, with no transition — the first
   * paint of a figure that opens in a non-default mode, or a reset. */
  jump(values: Record<string, number>): this {
    Object.assign(this.current, values);
    Object.assign(this.targets, values);
    return this;
  }

  /** Whether everything (or one named value) has arrived. */
  settled(key?: string): boolean {
    const keys = key === undefined ? Object.keys(this.targets) : [key];
    return keys.every((k) => Math.abs((this.targets[k] ?? 0) - (this.current[k] ?? 0)) < this.epsilon);
  }

  /**
   * Advance every value toward its target by `dt` seconds, and report
   * whether anything is still moving — a figure that only redraws on demand
   * can use that to stop, and one that animates anyway can ignore it.
   */
  advance(dt: number): boolean {
    if (!(dt > 0)) return !this.settled();
    const k = 1 - Math.pow(this.rate, dt);
    let moving = false;
    for (const key of Object.keys(this.targets)) {
      const to = this.targets[key] ?? 0;
      const from = this.current[key] ?? 0;
      if (Math.abs(to - from) < this.epsilon) {
        // Snapped rather than left a hair short: a value that never quite
        // arrives keeps every `settled()` check false and every redraw
        // scheduled, for a difference nothing can see.
        this.current[key] = to;
        continue;
      }
      this.current[key] = from + (to - from) * k;
      moving = true;
    }
    return moving;
  }

  /** The Frame for this moment: the diagram's own clock, plus every value
   * here by name, plus anything else this figure wants to pass through
   * (a toggle as 0/1, say). */
  frame(t: number, extra?: Record<string, number>): Frame {
    return frame(t, extra ? { ...this.current, ...extra } : { ...this.current });
  }
}
