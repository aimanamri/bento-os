// Copy with a guaranteed path to the text (EDGE-CASES §5.9):
// async Clipboard API → execCommand fallback → manual-copy modal.

import { confirmModal } from './ui.js';

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      /* fall through */
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return true;
  } catch (e) {
    /* fall through */
  }
  // Last resort: hand the text over for manual copy.
  await manualCopyModal(text);
  return false;
}

function manualCopyModal(text) {
  const dlg = document.getElementById('dlg-confirm');
  dlg.querySelector('#dlg-confirm-title').textContent = 'Copy manually';
  const body = dlg.querySelector('#dlg-confirm-body');
  body.textContent = 'Clipboard access is unavailable here (it needs HTTPS — e.g. the tailscale serve URL). Select and copy the text below:';
  const ta = document.createElement('textarea');
  ta.className = 'input mt-2 min-h-[120px] w-full font-mono text-xs';
  ta.value = text;
  ta.setAttribute('readonly', '');
  body.appendChild(ta);
  const actions = dlg.querySelector('#dlg-confirm-actions');
  actions.textContent = '';
  const done = document.createElement('button');
  done.className = 'btn btn-primary';
  done.textContent = 'Done';
  done.value = 'ok';
  actions.appendChild(done);
  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve();
    };
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    ta.select();
  });
}
