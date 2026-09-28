/**
 * What the editor knows: the document, what is selected, where the clock and
 * the parameter sliders stand, and the compiled figure that follows from all
 * of it.
 *
 * The shape is deliberately blunt. Every edit replaces the whole document with
 * a copy of it, recompiles the whole figure, and tells everyone to redraw.
 * There is no incremental update path, no dirty-tracking, no patching of live
 * objects in place — and that is the point rather than a shortcut:
 *
 *  - **It cannot drift.** The single hardest bug in an editor like this is the
 *    preview quietly disagreeing with the document, because some field had an
 *    update path and some other field didn't. If the only path is "recompile",
 *    there is nothing to be inconsistent with.
 *  - **Undo is free.** A copy per edit *is* the undo stack. No command objects,
 *    no inverse operations to get subtly wrong.
 *  - **It is fast enough, by a wide margin.** These documents are tens of
 *    objects; a clone and rebuild is well under a millisecond, and it happens
 *    on edits, not on frames. The draw loop touches none of this.
 *
 * The one concession to the fact that a drag emits an edit per pointer move is
 * `coalesce`: consecutive edits under the same key collapse into one undo
 * entry, so dragging a sphere's rim from 40 to 120 is one step back, not
 * eighty.
 */

import { compileDoc, type CompiledFigure } from './compile.js';
import { serializeDoc, type DiagramDoc, type ObjectDoc } from './doc.js';
import { Env } from './expr.js';

export interface EditOptions {
  /** what the undo entry is called, in the history and on the undo button */
  label?: string;
  /**
   * Fold this edit into the previous one when that one was made under the same
   * key — how a drag's worth of edits becomes a single step back. Any edit
   * with a different key (or none) closes the run.
   */
  coalesce?: string;
}

interface HistoryEntry {
  doc: DiagramDoc;
  label: string;
  coalesce?: string;
}

/** How many steps back the editor remembers. Documents are small; the cap is
 * about bounding memory in a long session, not about the cost of any one. */
const HISTORY_LIMIT = 200;

export class EditorState {
  /** The current document. Never mutate it — go through `edit()`, which is
   * what makes the change undoable and the figure follow it. */
  doc: DiagramDoc;
  /** The object the inspector is showing, and the canvas has handles on. */
  selectedId: string | null = null;
  /** Where each declared parameter's control currently stands. Not part of the
   * document: the document declares a parameter's *default*, and this is where
   * the slider happens to be right now, which is a property of looking at the
   * figure rather than of the figure. */
  params: Record<string, number> = {};
  /** The figure's clock. */
  t: number;
  /** Whether the clock is running in the editor. Always starts paused,
   * whatever the document says: `clock.running` is how the *emitted* figure
   * behaves, and a body that moves while you are trying to click it, or
   * attach something to it, is the first thing that makes an editor feel
   * broken. Press play to watch it go. */
  playing = false;
  /** Bumped whenever a whole document is loaded — how the editor knows to
   * re-fit the camera to a new figure, and not to an edit of this one. */
  loads = 0;
  /** The compiled figure — replaced wholesale on every edit. */
  fig: CompiledFigure;

  /** One Env for the whole session, so host-registered helpers survive every
   * recompile and its problem list accumulates across a draw. */
  readonly env = new Env();

  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private lastCoalesce: string | undefined;
  private listeners = new Set<(reason: ChangeReason) => void>();

  constructor(doc: DiagramDoc) {
    this.doc = doc;
    this.t = doc.clock.start ?? 0;
    this.resetParams();
    this.fig = compileDoc(this.doc, { env: this.env });
  }

  /** Tell me when anything changes. Returns the unsubscribe. */
  subscribe(fn: (reason: ChangeReason) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: ChangeReason): void {
    for (const fn of this.listeners) fn(reason);
  }

  /**
   * Change the document. `mutate` is handed a *copy* and may do as it likes to
   * it; returning `false` abandons the edit, which is how a control that fires
   * on every keystroke avoids filling the history with no-ops.
   */
  edit(mutate: (doc: DiagramDoc) => void | false, opts: EditOptions = {}): void {
    const next = structuredClone(this.doc);
    if (mutate(next) === false) return;

    const coalesced = opts.coalesce !== undefined && opts.coalesce === this.lastCoalesce && this.past.length > 0;
    if (!coalesced) {
      this.past.push({ doc: this.doc, label: opts.label ?? 'edit', ...(opts.coalesce !== undefined ? { coalesce: opts.coalesce } : {}) });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastCoalesce = opts.coalesce;
    this.future.length = 0;
    this.doc = next;
    this.recompile();
    this.emit('doc');
  }

  /** Close the current coalescing run, so the next edit starts a fresh undo
   * step. Called when a drag ends, and whenever focus leaves a text field. */
  breakCoalesce(): void {
    this.lastCoalesce = undefined;
  }

  /** Replace the document outright — loading a figure, or pasting JSON. Keeps
   * the history, so an accidental load is one undo away. */
  load(doc: DiagramDoc, label = 'load'): void {
    this.past.push({ doc: this.doc, label });
    this.future.length = 0;
    this.lastCoalesce = undefined;
    this.doc = doc;
    this.t = doc.clock.start ?? 0;
    this.playing = false;
    this.loads++;
    this.selectedId = null;
    this.resetParams();
    this.recompile();
    this.emit('doc');
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): void {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push({ doc: this.doc, label: entry.label });
    this.doc = entry.doc;
    this.lastCoalesce = undefined;
    this.afterHistory();
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push({ doc: this.doc, label: entry.label });
    this.doc = entry.doc;
    this.lastCoalesce = undefined;
    this.afterHistory();
  }

  private afterHistory(): void {
    // A step back may have removed whatever was selected; the inspector must
    // not be left showing an object that is no longer in the figure.
    if (this.selectedId !== null && !this.doc.objects.some((o) => o.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.resetParams({ keepExisting: true });
    this.recompile();
    this.emit('doc');
  }

  /** Bring `params` into line with what the document declares: a new parameter
   * arrives at its default, a removed one stops being read. */
  private resetParams(opts: { keepExisting?: boolean } = {}): void {
    const next: Record<string, number> = {};
    for (const p of this.doc.params) {
      const held = this.params[p.key];
      next[p.key] = opts.keepExisting && held !== undefined ? held : p.value;
    }
    this.params = next;
  }

  private recompile(): void {
    // Clearing the Env is what un-latches an expression that failed at draw
    // time: fix the text, and the object it belongs to comes back.
    this.env.invalidate();
    this.fig = compileDoc(this.doc, { env: this.env });
    this.resetParams({ keepExisting: true });
  }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('selection');
  }

  selected(): ObjectDoc | undefined {
    return this.doc.objects.find((o) => o.id === this.selectedId);
  }

  setParam(key: string, value: number): void {
    this.params[key] = value;
    this.emit('params');
  }

  setClock(t: number): void {
    this.t = t;
    this.emit('clock');
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.emit('clock');
  }

  /** This moment, as the figure's own Frame. */
  frame() {
    return this.fig.frameFor(this.t, this.params);
  }

  toJSON(): string {
    return serializeDoc(this.doc);
  }
}

export type ChangeReason = 'doc' | 'selection' | 'params' | 'clock';

/* -------------------------------------------------------------------------
 * Dotted paths
 *
 * The inspector addresses fields by path (`eccentric.ratio`) so that one
 * control implementation serves every field, nested or not. These three are
 * the whole of what that needs.
 * ---------------------------------------------------------------------- */

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Set a value, creating any intermediate objects on the way. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop();
  if (last === undefined) return;
  let cur: Record<string, unknown> = obj;
  for (const key of keys) {
    const next = cur[key];
    if (next === null || typeof next !== 'object') cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[last] = value;
}

/**
 * Remove a field — which is how the editor says "leave it at its default",
 * and is not the same as setting it to zero or false.
 *
 * A parent left with no keys is removed too: clearing `eccentric.ratio` should
 * leave no `eccentric` at all, rather than an empty object that the compiler
 * would read as "there is an eccentric, with no offset stated."
 */
export function deletePath(obj: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  const last = keys.pop();
  if (last === undefined) return;
  const parents: Record<string, unknown>[] = [obj];
  let cur: Record<string, unknown> = obj;
  for (const key of keys) {
    const next = cur[key];
    if (next === null || typeof next !== 'object') return;
    cur = next as Record<string, unknown>;
    parents.push(cur);
  }
  delete cur[last];
  for (let i = parents.length - 1; i > 0; i--) {
    const child = parents[i]!;
    if (Object.keys(child).length > 0) break;
    delete parents[i - 1]![keys[i - 1]!];
  }
}
