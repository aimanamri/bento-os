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

// In-memory mirror of the user list so actions can patch a single row
// (row.replaceWith / row.remove) instead of a full re-fetch + re-render —
// the dialog stays open and the search filter survives every action.
const adminState = { users: [], filter: '' };
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/;

async function openAdminPanel() {
  const dlg = document.getElementById('dlg-admin');
  document.getElementById('admin-search').value = '';
  adminState.filter = '';
  dlg.showModal();
  await loadAdminUsers();
}

async function loadAdminUsers() {
  const list = document.getElementById('admin-user-list');
  list.textContent = 'Loading…';
  try {
    ({ users: adminState.users } = await api('/api/users'));
  } catch {
    list.textContent = 'Could not load users.';
    return;
  }
  renderAdminList();
}

function visibleAdminUsers() {
  const term = adminState.filter.trim().toLowerCase();
  if (!term) return adminState.users;
  return adminState.users.filter((u) => u.username.toLowerCase().includes(term));
}

function renderAdminList() {
  const list = document.getElementById('admin-user-list');
  list.textContent = '';
  const visible = visibleAdminUsers();
  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'py-6 text-center text-sm text-ink-muted';
    empty.textContent = adminState.users.length === 0 ? 'No users yet.' : `Nothing matches “${adminState.filter.trim()}”.`;
    list.appendChild(empty);
    return;
  }
  for (const u of visible) list.appendChild(renderAdminRow(u));
}

function renderAdminRow(u) {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2 rounded-md border border-edge bg-panel-2/50 px-3 py-2';
  row.dataset.userId = u.id;

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
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn text-xs !py-1';
    resetBtn.textContent = 'Reset password';
    resetBtn.addEventListener('click', () => resetPassword(u, resetBtn));
    row.appendChild(resetBtn);
  }

  // Only the global admin promotes / demotes.
  if (state.user.role === 'global_admin' && u.role === 'user') {
    const promoteBtn = document.createElement('button');
    promoteBtn.className = 'btn text-xs !py-1';
    promoteBtn.textContent = 'Make admin';
    promoteBtn.addEventListener('click', async () => {
      promoteBtn.disabled = true;
      try {
        await api(`/api/users/${u.id}/promote`, { method: 'POST' });
      } catch (err) {
        promoteBtn.disabled = false;
        return toast(err instanceof ApiError ? err.message : 'Promotion failed', 'err');
      }
      u.role = 'admin';
      row.replaceWith(renderAdminRow(u));
      toast(`${u.username} is now an admin`);
    });
    row.appendChild(promoteBtn);
  }
  if (state.user.role === 'global_admin' && u.role === 'admin') {
    const demoteBtn = document.createElement('button');
    demoteBtn.className = 'btn text-xs !py-1';
    demoteBtn.textContent = 'Remove admin';
    demoteBtn.addEventListener('click', async () => {
      demoteBtn.disabled = true;
      try {
        await api(`/api/users/${u.id}/demote`, { method: 'POST' });
      } catch (err) {
        demoteBtn.disabled = false;
        return toast(err instanceof ApiError ? err.message : 'Demotion failed', 'err');
      }
      u.role = 'user';
      row.replaceWith(renderAdminRow(u));
      toast(`${u.username} is a normal user again`);
    });
    row.appendChild(demoteBtn);
  }

  // Delete: global_admin only, never self, never another global admin.
  if (state.user.role === 'global_admin' && u.role !== 'global_admin' && u.id !== state.user.id) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn text-xs !py-1 text-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteUser(u, row));
    row.appendChild(deleteBtn);
  }

  return row;
}

async function resetPassword(user, btn) {
  const choice = await confirmModal({
    title: `Reset ${user.username}'s password?`,
    body: `Their password returns to the default ("${DEFAULT_PASSWORD}") and they must choose a new one at next login.`,
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Reset password', value: 'reset', style: 'primary' },
    ],
  });
  if (choice !== 'reset') return;
  btn.disabled = true;
  try {
    await api(`/api/users/${user.id}/reset-password`, { method: 'POST' });
  } catch (err) {
    btn.disabled = false;
    return toast(err instanceof ApiError ? err.message : 'Reset failed', 'err');
  }
  user.requires_password_change = true;
  btn.closest('[data-user-id]')?.replaceWith(renderAdminRow(user));
  toast(`${user.username}'s password was reset to the default`);
}

async function deleteUser(user, row) {
  const choice = await confirmModal({
    title: `Delete ${user.username}?`,
    body: 'This permanently erases their account and every LogBook entry, prompt and snippet they own. There is no undo.',
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Delete everything', value: 'delete', style: 'danger' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    await api(`/api/users/${user.id}`, { method: 'DELETE' });
  } catch (err) {
    return toast(err instanceof ApiError ? err.message : 'Deletion failed', 'err');
  }
  adminState.users = adminState.users.filter((u) => u.id !== user.id);
  row.remove();
  toast(`${user.username} was deleted`);
}

async function createUser(username) {
  try {
    const { user } = await api('/api/users', { method: 'POST', body: { username } });
    const created = {
      id: user.id,
      username: user.username,
      role: user.role,
      requires_password_change: true,
    };
    adminState.users.push(created);
    adminState.users.sort((a, b) => a.username.localeCompare(b.username));
    renderAdminList();
    toast(`${created.username} created — default password is "${DEFAULT_PASSWORD}"`);
  } catch (err) {
    const message = err instanceof ApiError && err.code === 'USERNAME_TAKEN'
      ? 'That User ID is taken'
      : (err.message || 'Account creation failed');
    toast(message, 'err');
  }
}

function wireAdminPanel() {
  document.getElementById('admin-search').addEventListener('input', (e) => {
    adminState.filter = e.target.value;
    renderAdminList();
  });

  document.getElementById('admin-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('admin-create-username');
    const username = input.value.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      return toast('User ID: 2–32 letters, digits, dot, dash or underscore', 'err');
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    await createUser(username);
    btn.disabled = false;
    input.value = '';
  });
}

/* ── boot ───────────────────────────────────────────────────── */

export async function initAuth() {
  wireLoginForm();
  wireChangePasswordForm();
  wireUserMenu();
  wireAdminPanel();

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
