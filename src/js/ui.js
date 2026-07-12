// System feedback vocabulary — modal / banner / toast / announce (UX-SPEC §6).
// Everything is built with createElement + textContent: no user string ever
// reaches innerHTML from this module.

const toastsEl = document.getElementById('toasts');
const liveEl = document.getElementById('sr-live');
const bannerSlot = document.getElementById('banner-slot');

export function announce(message) {
  liveEl.textContent = '';
  requestAnimationFrame(() => (liveEl.textContent = message));
}

export function toast(message, kind = 'info', timeout = 3500) {
  while (toastsEl.children.length >= 2) toastsEl.firstChild.remove();

  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  if (kind === 'err') el.setAttribute('role', 'alert');
  el.textContent = message;
  toastsEl.appendChild(el);

  let remaining = timeout;
  let start = Date.now();
  let timer = setTimeout(dismiss, remaining);
  el.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    remaining -= Date.now() - start;
  });
  el.addEventListener('mouseleave', () => {
    start = Date.now();
    timer = setTimeout(dismiss, Math.max(remaining, 500));
  });
  function dismiss() {
    el.remove();
  }
  announce(message);
  return dismiss;
}

/**
 * Decision modal. actions: [{ label, value, style: 'primary'|'danger'|'' }]
 * Resolves with the chosen value, or 'cancel' on Esc/backdrop.
 * Destructive buttons are never default-focused (UX-SPEC §6).
 */
export function confirmModal({ title, body, actions }) {
  const dlg = document.getElementById('dlg-confirm');
  dlg.querySelector('#dlg-confirm-title').textContent = title;
  dlg.querySelector('#dlg-confirm-body').textContent = body || '';
  const wrap = dlg.querySelector('#dlg-confirm-actions');
  wrap.textContent = '';

  let focusTarget = null;
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (a.style === 'primary' ? ' btn-primary' : a.style === 'danger' ? ' btn-danger' : '');
    btn.textContent = a.label;
    btn.value = a.value;
    wrap.appendChild(btn);
    if (a.style !== 'danger' && !focusTarget) focusTarget = btn;
  }

  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve(dlg.returnValue || 'cancel');
      dlg.returnValue = '';
    };
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    (focusTarget || wrap.lastChild)?.focus();
  });
}

/** Persistent non-blocking banner; one at a time (UX-SPEC §6). */
export function showBanner({ id, message, actions = [] }) {
  clearBanner();
  const el = document.createElement('div');
  el.className = 'banner';
  el.dataset.bannerId = id;

  const text = document.createElement('span');
  text.className = 'flex-1';
  text.textContent = message;
  el.appendChild(text);

  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'btn text-xs py-1';
    btn.textContent = a.label;
    btn.addEventListener('click', () => a.onClick(clearBanner));
    el.appendChild(btn);
  }

  const dismiss = document.createElement('button');
  dismiss.className = 'icon-btn btn-ghost !py-1';
  dismiss.setAttribute('aria-label', 'Dismiss notice');
  dismiss.textContent = '✕';
  dismiss.addEventListener('click', clearBanner);
  el.appendChild(dismiss);

  bannerSlot.appendChild(el);
  announce(message);
}

export function clearBanner() {
  bannerSlot.textContent = '';
}

// Any [data-close-dialog] button closes its nearest dialog.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close-dialog]');
  if (btn) btn.closest('dialog')?.close();
});

/** Relative time for sidebar rows ("3d ago"); absolute in tooltip. */
export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatStamp(ts) {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
