// Shared event bus — feature modules never import each other across
// folders; they publish/subscribe here (IMPLEMENTATION-PLAN §4).
//
// Events:
//   tab:activate     { tabId }
//   entry:saved      { id, updated_at }
//   entry:dirty      { isDirty }
//   list:refresh     { source }
//   theme:changed    { dark }

const bus = new EventTarget();

export function emit(name, detail = {}) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, fn) {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(name, handler);
  return () => bus.removeEventListener(name, handler);
}
