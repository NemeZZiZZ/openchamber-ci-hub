// A small element factory: the panel is hand-built DOM plus the SDK's kit.

export type Child = Node | string | number | null | undefined | false;

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, unknown> | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'number' ? String(child) : child);
  }
  return node;
};

export const clear = (node: Element): void => {
  while (node.firstChild) node.firstChild.remove();
};

/** A slot to mount one kit control into. */
export const slot = (className = 'cih-slot'): HTMLSpanElement => h('span', { class: className });
