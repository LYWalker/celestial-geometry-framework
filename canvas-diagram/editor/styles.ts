/**
 * The editor's stylesheet, as a string.
 *
 * A string rather than a `.css` file because the kit ships TypeScript source
 * and nothing else — there is no build step here to turn a stylesheet into
 * something importable, and requiring consumers to wire one up for a
 * development tool would be a worse trade than this. It is injected once per
 * document, whatever number of editors are mounted.
 *
 * The palette is the figures' own: the same deep blue-black, the same
 * parchment ink, the same faint blue rules. An editor for these diagrams that
 * looked like a generic admin panel would make every colour decision inside it
 * harder to judge, because the surroundings would be lying about the context
 * the figure will actually live in.
 */

export const EDITOR_CSS = `
.cdx {
  --cdx-bg: #070b16;
  --cdx-panel: #0c1322;
  --cdx-line: rgba(150, 168, 214, 0.18);
  --cdx-ink: #e9e6df;
  --cdx-dim: #96a0bd;
  --cdx-accent: #8fd6c9;
  --cdx-warn: #e0b45c;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 520px;
  background: var(--cdx-bg);
  color: var(--cdx-ink);
  overflow: hidden;
  font: 13px/1.45 "Inter Variable", Inter, system-ui, sans-serif;
}
.cdx button,
.cdx input,
.cdx select,
.cdx textarea {
  font: inherit;
  color: inherit;
  background: rgba(150, 168, 214, 0.07);
  border: 1px solid var(--cdx-line);
  border-radius: 5px;
  padding: 0.22rem 0.4rem;
}
.cdx button { cursor: pointer; }
.cdx button:hover:not(:disabled) { border-color: var(--cdx-accent); }
.cdx button:disabled { opacity: 0.35; cursor: default; }
.cdx input:focus,
.cdx select:focus,
.cdx textarea:focus { outline: 1px solid var(--cdx-accent); outline-offset: -1px; }

.cdx-toolbar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--cdx-line);
  flex-wrap: wrap;
}
.cdx-title { min-width: 14rem; font-weight: 600; }
.cdx-spacer { flex: 0 0 0.6rem; }
.cdx-toolbar .cdx-spacer + * { margin-left: auto; }

.cdx-body { display: grid; grid-template-columns: 15rem 1fr 21rem; flex: 1; min-height: 0; }
/* Every column scrolls its own contents rather than growing the row it is in.
   A grid item's min-height is auto by default, meaning "at least as tall as my
   content" — so a figure with twenty objects in the list would push the whole
   editor past the bottom of its frame, overflow-y or not. This one zero is what
   makes the panels scroll instead of the page. */
.cdx-body > * { min-height: 0; }
.cdx-list,
.cdx-panel { overflow-y: auto; background: var(--cdx-panel); }
.cdx-list { border-right: 1px solid var(--cdx-line); padding: 0.4rem; }
.cdx-panel { border-left: 1px solid var(--cdx-line); display: flex; flex-direction: column; }
.cdx-panel-body { padding: 0.4rem 0.55rem 2rem; overflow-y: auto; overflow-x: hidden; }
.cdx-center { display: flex; flex-direction: column; min-width: 0; }

.cdx-stage { position: relative; flex: 1; min-height: 0; outline: none; }
.cdx-stage:focus-visible { outline: 1px solid var(--cdx-accent); outline-offset: -2px; }
.cdx-canvas { display: block; width: 100%; height: 100%; }
.cdx-tip {
  position: absolute;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  background: rgba(5, 8, 18, 0.96);
  border: 1px solid var(--cdx-line);
  font-size: 0.76rem;
  pointer-events: none;
  max-width: 18rem;
}
.cdx-tip .sub { display: block; color: var(--cdx-dim); }
.cdx-hint {
  position: absolute;
  left: 0.6rem;
  bottom: 0.5rem;
  padding: 0.25rem 0.5rem;
  border-radius: 5px;
  background: rgba(5, 8, 18, 0.9);
  border: 1px solid transparent;
  color: var(--cdx-accent);
  font-size: 0.74rem;
  line-height: 1.4;
  max-width: min(30rem, calc(100% - 1.2rem));
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s;
}
.cdx-hint.is-on { opacity: 1; border-color: var(--cdx-line); }

.cdx-controls {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
  padding: 0.4rem 0.6rem;
  border-top: 1px solid var(--cdx-line);
  background: var(--cdx-panel);
}
.cdx-play { width: 2rem; text-align: center; }
.cdx-scrub { flex: 1 1 10rem; min-width: 8rem; padding: 0; background: none; border: none; }
.cdx-clocklabel { color: var(--cdx-dim); font-variant-numeric: tabular-nums; min-width: 5rem; }
.cdx-ctl { display: flex; align-items: center; gap: 0.35rem; font-size: 0.78rem; color: var(--cdx-dim); }
.cdx-ctl input { padding: 0; background: none; border: none; width: 7rem; }
.cdx-pval { font-variant-numeric: tabular-nums; min-width: 2.6rem; }

.cdx-tabs { display: flex; border-bottom: 1px solid var(--cdx-line); }
.cdx-tabs button { flex: 1; border: none; border-radius: 0; background: none; padding: 0.4rem; color: var(--cdx-dim); }
.cdx-tabs button.is-on { color: var(--cdx-ink); box-shadow: inset 0 -2px 0 var(--cdx-accent); }

.cdx-group {
  margin: 0.9rem 0 0.35rem;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--cdx-dim);
  font-weight: 600;
}
.cdx-list .cdx-group { margin-top: 0.2rem; }
.cdx-empty { color: var(--cdx-dim); font-size: 0.8rem; margin: 0.4rem 0.2rem; }

.cdx-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.3rem;
  border-radius: 5px;
  cursor: pointer;
}
.cdx-item:hover { background: rgba(150, 168, 214, 0.08); }
.cdx-item.is-selected { background: rgba(143, 214, 201, 0.14); }
.cdx-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cdx-move { padding: 0 0.25rem; background: none; border: none; color: var(--cdx-dim); }
.cdx-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--cdx-dim); }
.cdx-dot-anchor { background: #9fb3d9; }
.cdx-dot-sphere { background: #e0b45c; }
.cdx-dot-connector { background: rgba(224, 180, 92, 0.7); border-radius: 1px; height: 3px; width: 10px; }
.cdx-dot-angle { background: var(--cdx-accent); }
.cdx-dot-trail { background: rgba(216, 212, 200, 0.7); border-radius: 1px; height: 3px; width: 10px; }
.cdx-dot-ringmarker { background: #dfe7fb; }

.cdx-field { margin-bottom: 0.5rem; }
.cdx-fhead { display: flex; align-items: center; gap: 0.3rem; }
.cdx-fname { font-size: 0.76rem; color: var(--cdx-dim); }
.cdx-field.is-set .cdx-fname { color: var(--cdx-ink); }
.cdx-fcontrol { margin-top: 0.15rem; }
.cdx-fcontrol input[type="text"],
.cdx-fcontrol input[type="number"],
.cdx-fcontrol select,
.cdx-fcontrol textarea { width: 100%; max-width: 100%; box-sizing: border-box; }
.cdx-help {
  margin: 0.2rem 0 0;
  font-size: 0.71rem;
  line-height: 1.4;
  color: rgba(150, 160, 189, 0.72);
}
.cdx-clear { padding: 0 0.3rem; background: none; border: none; color: var(--cdx-dim); line-height: 1; }
.cdx-clear:hover { color: var(--cdx-warn); }

.cdx-stack { display: flex; flex-direction: column; gap: 0.25rem; }
.cdx-pair { display: flex; gap: 0.3rem; align-items: center; }
.cdx-pair > * { min-width: 0; }
.cdx-grow { flex: 1; }
.cdx-sub { display: flex; align-items: center; gap: 0.2rem; font-size: 0.7rem; color: var(--cdx-dim); flex: 1; }
.cdx-sub input { width: 100%; }
.cdx-unit { font-size: 0.7rem; color: var(--cdx-dim); white-space: nowrap; }
.cdx-check { display: flex; align-items: center; gap: 0.35rem; font-size: 0.78rem; color: var(--cdx-dim); }
.cdx-check input { width: auto; }
.cdx-color { display: flex; gap: 0.3rem; }
.cdx-color input[type="color"] { width: 2rem; padding: 1px; flex: none; }
.cdx-fx-row { display: flex; gap: 0.3rem; align-items: flex-start; }
.cdx-fx-row > :first-child { flex: 1; min-width: 0; }
.cdx-fx { font-style: italic; padding: 0.22rem 0.35rem; flex: none; color: var(--cdx-dim); }
.cdx-fx.is-on { color: var(--cdx-bg); background: var(--cdx-accent); border-color: var(--cdx-accent); }
.cdx-expr { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.74rem; }
.cdx-param {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.35rem;
  margin-bottom: 0.4rem;
  border: 1px solid var(--cdx-line);
  border-radius: 6px;
}
.cdx-param input { width: 100%; box-sizing: border-box; }
.cdx-add { width: 100%; color: var(--cdx-dim); }

.cdx-problems { border-top: 1px solid var(--cdx-line); max-height: 8rem; overflow-y: auto; display: none; }
.cdx-problems.is-on { display: block; }
.cdx-problem {
  display: flex;
  gap: 0.5rem;
  padding: 0.25rem 0.6rem;
  font-size: 0.76rem;
  color: var(--cdx-warn);
  border-bottom: 1px solid rgba(224, 180, 92, 0.12);
}
.cdx-problem code { color: var(--cdx-dim); flex: none; font-size: 0.72rem; }

.cdx-drawer {
  position: absolute;
  inset: auto 0 0 0;
  height: 60%;
  display: flex;
  flex-direction: column;
  background: var(--cdx-panel);
  border-top: 1px solid var(--cdx-accent);
  z-index: 5;
}
.cdx { position: relative; }
.cdx-drawer[hidden] { display: none; }
.cdx-drawer-head { display: flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--cdx-line); }
.cdx-drawer-body { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.cdx-code {
  flex: 1;
  width: 100%;
  box-sizing: border-box;
  border: none;
  border-radius: 0;
  background: var(--cdx-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.73rem;
  line-height: 1.5;
  resize: none;
  white-space: pre;
}
.cdx-status { padding: 0.3rem 0.6rem; color: var(--cdx-warn); font-size: 0.76rem; }

@media (max-width: 960px) {
  .cdx-body { grid-template-columns: 1fr; grid-template-rows: auto 22rem auto; }
  .cdx-list, .cdx-panel { border: none; border-top: 1px solid var(--cdx-line); max-height: 18rem; }
}
`;
