// Authentication & RBAC UI (local variant — talks to /api/auth and /api/users
// via the api() wrapper; the session rides in an httpOnly cookie, so there is
// no token to handle in JS). Mirrors the flows in docs/IMPLEMENTATION-LOCAL §7:
//   * signed out                → full-screen login portal
//   * requires_password_change  → forced #/change-password before the app
//   * signed in                 → app shell, navbar shows the username

import { api, ApiError, setAuthErrorHandler } from './api.js';
import { toast, confirmModal, announce } from './ui.js';

const PASSWORD_MIN = 8;
const DEFAULT_PASSWORD = 'bentoos';

const authScreen = document.getElementById('auth-screen');
const frame = document.getElementById('frame');
const loginForm = document.getElementById('auth-login-form');
const cpForm = document.getElementById('auth-cp-form');
const loginError = document.getElementById('auth-error');
const cpError = document.getElementById('cp-error');

const state = { user: null };
let booted = false;       // app shell has been shown at least once
let cpForced = false;     // forced-rotation traps the change-password view
let resolveReady;         // resolves initAuth()'s gate promise

export function getAuthState() {
  return state;
}

/* ── view switching ─────────────────────────────────────────── */

function showAuthScreen(view, { forced = false } = {}) {
  frame.style.display = 'none';
  authScreen.style.display = 'flex';
  const isLogin = view === 'login';
  cpForced = !isLogin && forced;
  document.getElementById('cp-cancel').classList.toggle('hidden', isLogin || forced);
  document.getElementById('cp-current-wrap').classList.toggle('hidden', !isLogin && forced);
  loginForm.classList.toggle('hidden', !isLogin);
  loginForm.classList.toggle('flex', isLogin);
  cpForm.classList.toggle('hidden', isLogin);
  cpForm.classList.toggle('flex', !isLogin);
  location.hash = isLogin ? '#/login' : '#/change-password';
  (isLogin ? document.getElementById('auth-username') : document.getElementById('cp-new')).focus();
}

function showApp() {
  authScreen.style.display = 'none';
  frame.style.display = '';
  booted = true;
  if (location.hash === '#/login' || location.hash === '#/change-password') location.hash = '';
}

function setError(el, message) {
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

/* ── navbar ─────────────────────────────────────────────────── */

function renderNavbar() {
  const u = state.user;
  document.getElementById('nav-username').textContent = u.username;
  const badge = document.getElementById('nav-role-badge');
  badge.textContent = u.role === 'global_admin' ? 'global admin' : u.role === 'admin' ? 'admin' : '';
  badge.classList.toggle('hidden', u.role === 'user');
  document.getElementById('menu-admin').classList.toggle('hidden', u.role === 'user');
  document.getElementById('menu-delete').classList.toggle('hidden', u.role === 'global_admin');
  document.getElementById('nav-user').classList.remove('hidden');
}

/* ── post-login routing ─────────────────────────────────────── */

function finishLogin(user) {
  state.user = user;
  if (user.requires_password_change) {
    showAuthScreen('change-password', { forced: true });
    return;
  }
  renderNavbar();
  showApp();
  announce(`Signed in as ${user.username}`);
  resolveReady?.();
}

/* ── login / signup ─────────────────────────────────────────── */

let signupMode = false;

function wireLoginForm() {
  const modeToggle = document.getElementById('auth-mode-toggle');
  const submitBtn = document.getElementById('auth-submit');

  modeToggle.addEventListener('click', () => {
    signupMode = !signupMode;
    submitBtn.textContent = signupMode ? 'Create account' : 'Sign in';
    modeToggle.textContent = signupMode ? 'I already have an account' : 'Create an account';
    setError(loginError, '');
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(loginError, '');
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!username) return setError(loginError, 'User ID is required');
    if (!password) return setError(loginError, 'Password is required');
    if (signupMode && password.length < PASSWORD_MIN) {
      return setError(loginError, `Password needs at least ${PASSWORD_MIN} characters`);
    }

    submitBtn.disabled = true;
    try {
      const path = signupMode ? '/api/auth/signup' : '/api/auth/login';
      const { user } = await api(path, { method: 'POST', body: { username, password } });
      loginForm.reset();
      finishLogin(user);
    } catch (err) {
      setError(loginError, err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ── change password ────────────────────────────────────────── */

function wireChangePasswordForm() {
  document.getElementById('cp-cancel').addEventListener('click', () => {
    if (cpForced) return;
    cpForm.reset();
    setError(cpError, '');
    showApp();
  });

  cpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(cpError, '');
    const current = document.getElementById('cp-current').value;
    const next = document.getElementById('cp-new').value;
    const confirm = document.getElementById('cp-confirm').value;

    if (next === DEFAULT_PASSWORD) return setError(cpError, 'The default password cannot be reused');
    if (next.length < PASSWORD_MIN) return setError(cpError, `Password needs at least ${PASSWORD_MIN} characters`);
    if (next !== confirm) return setError(cpError, 'Passwords do not match');
    if (!cpForced && !current) return setError(cpError, 'Enter your current password');

    const btn = document.getElementById('cp-submit');
    btn.disabled = true;
    try {
      const body = cpForced ? { new_password: next } : { new_password: next, current_password: current };
      const { user } = await api('/api/auth/change-password', { method: 'POST', body });
      cpForm.reset();
      toast('Password updated', 'info');
      finishLogin(user);
    } catch (err) {
      setError(cpError, err instanceof ApiError ? err.message : 'Could not change password');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ── user menu ──────────────────────────────────────────────── */

function wireUserMenu() {
  const btn = document.getElementById('nav-user-btn');
  const menu = document.getElementById('user-menu');
  const closeMenu = () => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());

  document.getElementById('menu-signout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    location.reload();
  });

  document.getElementById('menu-changepw').addEventListener('click', () => {
    closeMenu();
    document.getElementById('cp-current').value = '';
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
    showAuthScreen('change-password', { forced: false });
  });

  document.getElementById('menu-admin').addEventListener('click', () => {
    closeMenu();
    openAdminPanel();
  });

  document.getElementById('menu-delete').addEventListener('click', async () => {
    closeMenu();
    const choice = await confirmModal({
      title: 'Delete your account?',
      body: 'This permanently erases your account, every LogBook entry and every prompt. There is no undo (GDPR/PDPA hard delete).',
      actions: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete everything', value: 'delete', style: 'danger' },
      ],
    });
    if (choice !== 'delete') return;
    try {
      await api('/api/users/me', { method: 'DELETE' });
      toast('Account deleted');
    } catch (err) {
      return toast('Account deletion failed', 'err');
    }
    location.reload();
  });
}

/* ── admin panel (usernames + roles only — data blindness) ──── */

async function openAdminPanel() {
  const dlg = document.getElementById('dlg-admin');
  const list = document.getElementById('admin-user-list');
  list.textContent = 'Loading…';
  dlg.showModal();

  let users;
  try {
    ({ users } = await api('/api/users'));
  } catch {
    list.textContent = 'Could not load users.';
    return;
  }

  list.textContent = '';
  for (const u of users) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 rounded-md border border-edge bg-panel-2/50 px-3 py-2';

    const name = document.createElement('span');
    name.className = 'min-w-0 flex-1 truncate text-sm font-medium';
    name.textContent = u.username;
    row.appendChild(name);

    const badge = document.createElement('span');
    badge.className = 'rounded-full border border-edge px-2 py-0.5 text-[11px] text-ink-muted';
    badge.textContent = u.role === 'global_admin' ? 'global admin' : u.role;
    row.appendChild(badge);

    if (u.requires_password_change) {
      const flag = document.createElement('span');
      flag.className = 'text-[11px] text-warn-hue';
      flag.title = 'Must change password on next login';
      flag.textContent = 'pw reset pending';
      row.appendChild(flag);
    }

    // Admins (and the global admin) may reset Normal User passwords only.
    if (u.role === 'user' && u.id !== state.user.id) {
      row.appendChild(actionButton('Reset password', () => resetPassword(u)));
    }
    // Only the global admin promotes / demotes.
    if (state.user.role === 'global_admin' && u.role === 'user') {
      row.appendChild(actionButton('Make admin', () => roleAction(`/api/users/${u.id}/promote`, `${u.username} is now an admin`)));
    }
    if (state.user.role === 'global_admin' && u.role === 'admin') {
      row.appendChild(actionButton('Remove admin', () => roleAction(`/api/users/${u.id}/demote`, `${u.username} is a normal user again`)));
    }

    list.appendChild(row);
  }
}

function actionButton(label, onClick) {
  const b = document.createElement('button');
  b.className = 'btn text-xs !py-1';
  b.textContent = label;
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await onClick(); } finally { b.disabled = false; }
  });
  return b;
}

async function roleAction(path, successMsg) {
  try {
    await api(path, { method: 'POST' });
    toast(successMsg);
    openAdminPanel();
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Action failed', 'err');
  }
}

async function resetPassword(user) {
  const choice = await confirmModal({
    title: `Reset ${user.username}'s password?`,
    body: `Their password returns to the default ("${DEFAULT_PASSWORD}") and they must choose a new one at next login.`,
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Reset password', value: 'reset', style: 'primary' },
    ],
  });
  if (choice !== 'reset') return;
  try {
    await api(`/api/users/${user.id}/reset-password`, { method: 'POST' });
    toast(`${user.username}'s password was reset to the default`);
    openAdminPanel();
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Reset failed', 'err');
  }
}

/* ── boot ───────────────────────────────────────────────────── */

export async function initAuth() {
  wireLoginForm();
  wireChangePasswordForm();
  wireUserMenu();

  // Mid-session reactions: an expired cookie (401) or a fresh forced-rotation
  // flag (403) on any later call bounces the whole app to the right screen.
  setAuthErrorHandler((kind) => {
    if (kind === 'password_change') showAuthScreen('change-password', { forced: true });
    else if (booted) location.reload(); // clean slate for a different user
    else showAuthScreen('login');
  });

  const ready = new Promise((resolve) => (resolveReady = resolve));

  try {
    const { user } = await api('/api/auth/me');
    finishLogin(user);
  } catch (err) {
    // 401 here is expected when signed out; the handler already showed login,
    // but call it explicitly in case the request failed some other way.
    showAuthScreen('login');
  }

  await ready;
  return state;
}
