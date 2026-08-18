// PWA wiring: service-worker lifecycle + the install affordance.
//
// Everything here is best-effort. A browser with no service worker, a
// registration that fails, or a host served over plain http still gets the
// full app — offline support is an enhancement, never a boot dependency.

import { toast } from './ui.js';
import { t } from './i18n.js';

const SW_URL = '/sw.js';

let deferredPrompt = null;

function wireInstallPrompt() {
  const item = document.getElementById('menu-install');
  if (!item) return;

  // Chromium fires this instead of showing its own bar once the install
  // criteria are met; stash it so the user can install from the account menu
  // rather than at whatever moment the browser felt like asking.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    item.classList.remove('hidden');
  });

  item.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    item.classList.add('hidden');
    const prompt = deferredPrompt;
    deferredPrompt = null; // a prompt can only be used once
    prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome !== 'accepted') item.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    item.classList.add('hidden');
    toast(t('pwa.installed'), 'ok');
  });
}

async function register() {
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });

    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        // `controller` is null on the very first install — that one is not an
        // update and needs no announcement.
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          toast(t('pwa.updateReady'), 'info', 6000);
        }
      });
    });
  } catch {
    // No offline shell this session; nothing else changes.
  }
}

export function initPwa() {
  wireInstallPrompt();
  if (!('serviceWorker' in navigator)) return;

  // Registering costs a multi-megabyte precache, so keep it off the critical
  // path. main.js awaits auth before booting, by which time `load` may have
  // already fired — hence the readyState check rather than a bare listener.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
