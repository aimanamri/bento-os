// Theme (dark-first; UX-SPEC §1).
//
// One module drives every toggle on the page — the title bar's inside the app
// and the lock screen's outside it — by wiring anything marked
// [data-theme-toggle]. The lock screen needs its own because the whole window
// frame, and with it the title bar, is hidden until you sign in.
//
// With no stored choice the app follows the device and keeps following it: a
// system switch flips the app live until the user picks a side, at which point
// their choice sticks and the device stops being consulted (UX-SPEC §1:
// "initial value from prefers-color-scheme").

import { setMermaidTheme } from './render.js';
import { emit } from './bus.js';

const STORAGE_KEY = 'bento.theme';
const systemQuery = window.matchMedia('(prefers-color-scheme: dark)');

function storedChoice() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode, or storage disabled — fall back to the device
  }
}

export function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  setMermaidTheme(dark);
  emit('theme:changed', { dark });
}

export function initTheme() {
  const stored = storedChoice();
  applyTheme(stored ? stored === 'dark' : systemQuery.matches);

  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nowDark = !document.documentElement.classList.contains('dark');
      try {
        localStorage.setItem(STORAGE_KEY, nowDark ? 'dark' : 'light');
      } catch {
        /* the toggle still works for this session */
      }
      applyTheme(nowDark);
    });
  });

  // Only while the user hasn't chosen: once they have, the device loses the vote.
  systemQuery.addEventListener('change', (e) => {
    if (!storedChoice()) applyTheme(e.matches);
  });
}
