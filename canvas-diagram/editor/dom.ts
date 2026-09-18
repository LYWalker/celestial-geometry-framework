/**
 * The four DOM helpers the editor's panels are built from.
 *
 * Deliberately not a framework and deliberately not much. The kit has no
 * runtime dependencies and this is not the place to acquire one; what the
 * panels actually need is "make an element with these attributes and these
 * children", and everything else — the object list, the inspector, the
 * toolbar — is a function from state to a fresh subtree.
 */

type Child = Node | string | null | undefined | false;

export interface ElOptions {
  class?: string;
  title?: string;
  text?: string;
  html?: string;
  /** anything else: attributes by name, `on*` by event */
  [key: string]: unknown;
}

/**
 * `el('div', { class: 'row' }, child, child)`.
 *
 * A key beginning `on` is an event listener, a boolean attribute is set or
 * omitted rather than stringified (`disabled: false` must not become
 * `disabled="false"`, which is still disabled), and everything else is an
 * ordinary attribute.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined || value === null) continue;
    if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Empty an element — what every panel does before rebuilding itself. */
export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * A `<select>` over a list of options, with the current one chosen.
 *
 * Its own helper because the editor builds a dozen of them (a kind, an enum, a
 * reference to another object) and `selected` on the option rather than
 * `value` on the select is the form that survives an option list rebuilt
 * underneath it.
 */
export function select(
  options: { value: string; label: string; disabled?: boolean }[],
  current: string,
  onChange: (value: string) => void,
  opts: ElOptions = {},
): HTMLSelectElement {
  const node = el('select', { ...opts, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) });
  for (const o of options) {
    const option = el('option', { value: o.value, text: o.label });
    if (o.disabled) option.disabled = true;
    if (o.value === current) option.selected = true;
    node.appendChild(option);
  }
  return node;
}
