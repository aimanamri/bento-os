// Authentication & RBAC UI (local variant — talks to /api/auth and /api/users
// via the api() wrapper; the session rides in an httpOnly cookie, so there is
// no token to handle in JS). Mirrors the flows in docs/IMPLEMENTATION-LOCAL §7:
//   * signed out                → full-screen login portal
//   * requires_password_change  → forced #/change-password before the app
//   * signed in                 → app shell, navbar shows the username

import { api, ApiError, setAuthErrorHandler } from './api.js';
import { toast, confirmModal, announce } from './ui.js';
import { initFaceCard } from './face-card.js';
import { initTour } from './tour.js';
import { t, localeTag } from './i18n.js';
import { on } from './bus.js';

const PASSWORD_MIN = 8;
const DEFAULT_PASSWORD = 'bentoos';
const SUCCESS_HOLD_MS = 450; // let the greeting land before the app takes over
const FLINCH_HOLD_MS = 1800; // how long a rejected sign-in keeps the sad face

const authScreen = document.getElementById('auth-screen');
const frame = document.getElementById('frame');
const loginForm = document.getElementById('auth-login-form');
const cpForm = document.getElementById('auth-cp-form');
const loginError = document.getElementById('auth-error');
const cpError = document.getElementById('cp-error');
const authCard = document.getElementById('auth-card');
const authSub = document.getElementById('auth-sub');

/* ── lock screen: greeter + clock ───────────────────────────── */

let greeter = null; // face-card controller, created in initAuth

const lockVisible = () => authScreen.style.display !== 'none';

// A wrong password should be felt, not just read. The flinch is a reaction,
// not a mood: it hands the face back to the cursor shortly after, so one typo
// doesn't leave the greeter sulking for the rest of the session.
let flinchTimer = null;

function flinch() {
  greeter?.setState('danger');
  clearTimeout(flinchTimer);
  flinchTimer = setTimeout(() => greeter?.release(), FLINCH_HOLD_MS);
  if (!authCard) return;
  authCard.classList.remove('shake');
  void authCard.offsetWidth; // restart the animation on a repeat failure
  authCard.classList.add('shake');
}

let clockTimer = null;

// Follows the device: local time, and the display language's own 12/24-hour
// and date format.
function startClock() {
  const time = document.getElementById('auth-clock-time');
  const date = document.getElementById('auth-clock-date');
  if (!time || !date) return;

  const tick = () => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString(localeTag(), { hour: 'numeric', minute: '2-digit' });
    date.textContent = now.toLocaleDateString(localeTag(), { weekday: 'long', day: 'numeric', month: 'long' });
  };
  // Wake on the minute boundary rather than polling every second.
  const schedule = () => {
    clockTimer = setTimeout(() => {
      tick();
      schedule();
    }, 60_000 - (Date.now() % 60_000) + 50);
  };
  tick();
  schedule();
}

function stopClock() {
  clearTimeout(clockTimer);
  clockTimer = null;
}

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
  // The change-password view shares this sheet, so it gets the same greeter —
  // it just isn't a greeting at that point.
  authSub.textContent = t(isLogin ? 'auth.signInSub' : 'auth.oneMoreStep');
  greeter?.release();
  startClock();
  location.hash = isLogin ? '#/login' : '#/change-password';
  (isLogin ? document.getElementById('auth-username') : document.getElementById('cp-new')).focus();
}

function showApp() {
  stopClock();
  clearTimeout(flinchTimer);
  authScreen.style.display = 'none';
  frame.style.display = '';
  booted = true;
  if (location.hash === '#/login' || location.hash === '#/change-password') location.hash = '';
}

function setError(el, message) {
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

// Every rejection on the lock screen: show the message, flinch the greeter.
function rejectAuth(el, message) {
  setError(el, message);
  flinch();
}

/* ── navbar ─────────────────────────────────────────────────── */

function renderNavbar() {
  const u = state.user;
  document.getElementById('nav-username').textContent = u.username;
  const badge = document.getElementById('nav-role-badge');
  badge.textContent =
    u.role === 'global_admin' ? t('admin.role.global_admin') : u.role === 'admin' ? t('admin.role.admin') : '';
  badge.classList.toggle('hidden', u.role === 'user');
  document.getElementById('menu-admin').classList.toggle('hidden', u.role === 'user');
  document.getElementById('menu-delete').classList.toggle('hidden', u.role === 'global_admin');
  document.getElementById('nav-user').classList.remove('hidden');
}

/* ── post-login routing ─────────────────────────────────────── */

async function finishLogin(user) {
  state.user = user;
  if (user.requires_password_change) {
    showAuthScreen('change-password', { forced: true });
    return;
  }
  // Coming off the lock screen, let the greeter register the win before the
  // workspace takes over. A restored session has no lock screen to hold.
  if (lockVisible()) {
    greeter?.setState('ok');
    authSub.textContent = t('auth.welcomeBack', { name: user.username });
    await new Promise((resolve) => setTimeout(resolve, SUCCESS_HOLD_MS));
  }
  renderNavbar();
  showApp();
  announce(t('auth.signedInAs', { name: user.username }));
  resolveReady?.();
}

/* ── login / signup ─────────────────────────────────────────── */

let signupMode = false;

function wireLoginForm() {
  const modeToggle = document.getElementById('auth-mode-toggle');
  const submitBtn = document.getElementById('auth-submit');

  modeToggle.addEventListener('click', () => {
    signupMode = !signupMode;
    submitBtn.textContent = t(signupMode ? 'auth.createAccountSubmit' : 'auth.signIn');
    modeToggle.textContent = t(signupMode ? 'auth.haveAccount' : 'auth.createAccountLink');
    setError(loginError, '');
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(loginError, '');
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!username) return rejectAuth(loginError, t('auth.err.usernameRequired'));
    if (!password) return rejectAuth(loginError, t('auth.err.passwordRequired'));
    if (signupMode && password.length < PASSWORD_MIN) {
      return rejectAuth(loginError, t('auth.err.shortPassword', { n: PASSWORD_MIN }));
    }

    submitBtn.disabled = true;
    try {
      const path = signupMode ? '/api/auth/signup' : '/api/auth/login';
      const { user } = await api(path, { method: 'POST', body: { username, password } });
      loginForm.reset();
      await finishLogin(user);
    } catch (err) {
      rejectAuth(loginError, err instanceof ApiError ? err.message : t('auth.err.failed'));
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

    if (next === DEFAULT_PASSWORD) return rejectAuth(cpError, t('auth.err.defaultReuse'));
    if (next.length < PASSWORD_MIN) return rejectAuth(cpError, t('auth.err.shortPassword', { n: PASSWORD_MIN }));
    if (next !== confirm) return rejectAuth(cpError, t('auth.err.mismatch'));
    if (!cpForced && !current) return rejectAuth(cpError, t('auth.err.currentPasswordRequired'));

    const btn = document.getElementById('cp-submit');
    btn.disabled = true;
    try {
      const body = cpForced ? { new_password: next } : { new_password: next, current_password: current };
      const { user } = await api('/api/auth/change-password', { method: 'POST', body });
      cpForm.reset();
      toast(t('auth.toast.pwUpdated'), 'info');
      await finishLogin(user);
    } catch (err) {
      rejectAuth(cpError, err instanceof ApiError ? err.message : t('auth.err.changePasswordFailed'));
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
      title: t('auth.delete.title'),
      body: t('auth.delete.bodyLocal'),
      actions: [
        { label: t('common.cancel'), value: 'cancel' },
        { label: t('auth.delete.confirm'), value: 'delete', style: 'danger' },
      ],
    });
    if (choice !== 'delete') return;
    try {
      await api('/api/users/me', { method: 'DELETE' });
      toast(t('auth.delete.done'));
    } catch (err) {
      return toast(t('auth.delete.failedLocal'), 'err');
    }
    location.reload();
  });
}

/* ── admin panel (usernames + roles only — data blindness) ──── */

// In-memory mirror of the user list so actions can patch a single row
// (row.replaceWith / row.remove) instead of a full re-fetch + re-render —
// the dialog stays open and the search filter survives every action.
// Role sections only start paying for themselves once the roster is long
// enough that scanning it is work; below this a flat list reads faster.
const GROUP_AT = 8;

// Role keys are the database's, not the reader's — the display strings hang
// off them so a language switch redraws the list without touching the model.
const ROLE_LABEL = (role) => t(`admin.role.${role}`);
const ROLE_ORDER = ['global_admin', 'admin', 'user'];
const ROLE_SECTION = (role) => t(`admin.section.${role}`);

const adminState = { users: [], filter: '', openId: null };

async function openAdminPanel() {
  const dlg = document.getElementById('dlg-admin');
  document.getElementById('admin-search').value = '';
  adminState.filter = '';
  adminState.openId = null;
  hideCreateForm();
  dlg.showModal();
  await loadAdminUsers();
}

async function loadAdminUsers() {
  const list = document.getElementById('admin-user-list');
  list.textContent = t('admin.loading');

  try {
    // created_at is a UNIX-ms integer here, which new Date() takes directly.
    ({ users: adminState.users } = await api('/api/users'));
  } catch {
    list.textContent = t('admin.loadFailed');
    return;
  }
  renderAdminList();
}

function visibleAdminUsers() {
  const term = adminState.filter.trim().toLowerCase();
  if (!term) return adminState.users;
  return adminState.users.filter((u) => u.username.toLowerCase().includes(term));
}

function joinedLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Every action this admin may take on this user, and what each one does.
 * The single source of truth for the row's affordances — an empty list means
 * the row has nothing to offer and must not pretend otherwise by expanding.
 * Mirrors the RPC and Edge Function rules; the backend still enforces them.
 */
function actionsFor(u) {
  const actions = [];
  const isSelf = u.id === state.user.id;
  const isGlobalAdmin = state.user.role === 'global_admin';

  // Any admin, but only on normal users, and never on themselves.
  if (u.role === 'user' && !isSelf) {
    actions.push({
      label: t('admin.action.reset.label'),
      button: t('admin.action.reset.button'),
      description: t('admin.action.reset.desc'),
      run: (btn) => resetPassword(u, btn),
    });
  }
  if (isGlobalAdmin && u.role === 'user') {
    actions.push({
      label: t('admin.action.promote.label'),
      button: t('admin.action.promote.button'),
      description: t('admin.action.promote.desc'),
      run: (btn) => changeRole(u, 'promote', btn),
    });
  }
  if (isGlobalAdmin && u.role === 'admin') {
    actions.push({
      label: t('admin.action.demote.label'),
      button: t('admin.action.demote.button'),
      description: t('admin.action.demote.desc'),
      run: (btn) => changeRole(u, 'demote', btn),
    });
  }
  if (isGlobalAdmin && u.role !== 'global_admin' && !isSelf) {
    actions.push({
      danger: true,
      label: t('admin.action.delete.label'),
      button: t('admin.action.delete.button'),
      description: t('admin.action.delete.desc'),
      run: () => deleteUser(u),
    });
  }
  return actions;
}

function renderAdminList() {
  const list = document.getElementById('admin-user-list');
  const count = document.getElementById('admin-count');
  list.textContent = '';

  const visible = visibleAdminUsers();
  const total = adminState.users.length;
  count.textContent = total ? t('admin.count', { n: total }) : '';

  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'py-6 text-center text-sm text-ink-muted';
    empty.textContent = total === 0 ? t('admin.noUsers') : t('common.noMatchQuery', { q: adminState.filter.trim() });
    list.appendChild(empty);
    return;
  }

  // Below the threshold a flat list reads faster than three labelled sections.
  if (visible.length < GROUP_AT) {
    for (const u of visible) list.appendChild(renderAdminRow(u));
    return;
  }

  for (const role of ROLE_ORDER) {
    const members = visible.filter((u) => u.role === role);
    if (members.length === 0) continue;

    const heading = document.createElement('div');
    heading.className = 'flex items-center gap-2 pt-1 text-[11px] uppercase tracking-wider text-ink-muted';
    heading.append(ROLE_SECTION(role));
    const badge = document.createElement('span');
    badge.className = 'rounded-full border border-edge px-1.5';
    badge.textContent = String(members.length);
    heading.appendChild(badge);
    list.appendChild(heading);

    const group = document.createElement('div');
    group.className = 'flex flex-col gap-1.5';
    for (const u of members) group.appendChild(renderAdminRow(u));
    list.appendChild(group);
  }
}

function rolePill(role) {
  const pill = document.createElement('span');
  const tone =
    role === 'global_admin' ? 'border-purple/55 text-purple'
    : role === 'admin' ? 'border-accent/55 text-accent'
    : 'border-edge text-ink-muted';
  pill.className = `rounded-full border px-2 py-0.5 text-[11px] ${tone}`;
  pill.textContent = ROLE_LABEL(role) || role;
  return pill;
}

function renderAdminRow(u) {
  const actions = actionsFor(u);
  const expandable = actions.length > 0;
  const open = expandable && adminState.openId === u.id;

  const row = document.createElement('div');
  row.className = `overflow-hidden rounded-md border ${open ? 'border-accent/40 bg-panel-2' : 'border-edge bg-panel-2/50'}`;
  row.dataset.userId = u.id;

  // The header is a button only when there is something behind it.
  const head = document.createElement(expandable ? 'button' : 'div');
  head.className = 'flex w-full items-center gap-2 px-3 py-2 text-left';
  if (expandable) {
    head.type = 'button';
    head.setAttribute('aria-expanded', String(open));
    head.classList.add('cursor-pointer', 'hover:bg-panel-2');
  }

  const avatar = document.createElement('span');
  const avatarTone =
    u.role === 'global_admin' ? 'border-purple/50 text-purple'
    : u.role === 'admin' ? 'border-accent/50 text-accent'
    : 'border-edge text-ink-muted';
  avatar.className = `flex h-7 w-7 flex-none items-center justify-center rounded-md border bg-panel text-xs font-semibold uppercase ${avatarTone}`;
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = u.username.slice(0, 1);
  head.appendChild(avatar);

  const name = document.createElement('span');
  name.className = 'min-w-0 flex-1 truncate text-sm font-medium';
  name.textContent = u.username;
  head.appendChild(name);

  head.appendChild(rolePill(u.role));

  if (u.id === state.user.id) {
    const you = document.createElement('span');
    you.className = 'rounded-full border border-ok-hue/50 px-2 py-0.5 text-[11px] text-ok-hue';
    you.textContent = t('admin.you');
    // Half the actions are withheld on your own row; say so rather than
    // leaving an admin to wonder why it does nothing.
    you.title = t('admin.youTitle');
    head.appendChild(you);
  }

  if (u.requires_password_change) {
    const flag = document.createElement('span');
    flag.className = 'rounded-full border border-warn-hue/55 px-2 py-0.5 text-[11px] text-warn-hue';
    flag.title = t('admin.resetPendingTitle');
    flag.textContent = t('admin.resetPending');
    head.appendChild(flag);
  }

  const joined = joinedLabel(u.created_at);
  if (joined) {
    const when = document.createElement('span');
    when.className = 'whitespace-nowrap text-[11px] tabular-nums text-ink-muted';
    when.title = t('admin.accountCreated');
    when.textContent = joined;
    head.appendChild(when);
  }

  if (expandable) {
    const chevron = document.createElement('span');
    chevron.className = `text-ink-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`;
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    head.appendChild(chevron);
    head.addEventListener('click', () => {
      // One row open at a time: a long roster shouldn't turn into a wall.
      adminState.openId = adminState.openId === u.id ? null : u.id;
      renderAdminList();
    });
  }

  row.appendChild(head);
  if (open) row.appendChild(renderAdminActions(u, actions));
  return row;
}

function renderAdminActions(u, actions) {
  const drop = document.createElement('div');
  drop.className = 'flex flex-col gap-2.5 border-t border-edge bg-panel px-3 py-3';

  for (const action of actions) {
    const line = document.createElement('div');
    line.className = 'flex items-center justify-between gap-3';

    const text = document.createElement('div');
    text.className = 'min-w-0';
    const label = document.createElement('div');
    label.className = `text-xs font-semibold ${action.danger ? 'text-danger' : ''}`;
    label.textContent = action.label;
    const desc = document.createElement('p');
    desc.className = 'text-[11px] leading-snug text-ink-muted';
    desc.textContent = action.description;
    text.append(label, desc);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn flex-none text-xs !py-1 ${action.danger ? 'text-danger border-danger/40' : ''}`;
    btn.textContent = action.button;
    btn.addEventListener('click', () => action.run(btn));

    line.append(text, btn);
    drop.appendChild(line);
  }
  return drop;
}

async function changeRole(u, direction, btn) {
  const promote = direction === 'promote';
  btn.disabled = true;
  try {
    await api(`/api/users/${u.id}/${promote ? 'promote' : 'demote'}`, { method: 'POST' });
  } catch (err) {
    btn.disabled = false;
    const fallback = t(promote ? 'admin.promoteFailed' : 'admin.demoteFailed');
    return toast(err instanceof ApiError ? err.message : fallback, 'err');
  }
  u.role = promote ? 'admin' : 'user';
  // The permitted actions change with the role, so re-render rather than patch.
  renderAdminList();
  toast(t(promote ? 'admin.nowAdmin' : 'admin.nowUser', { name: u.username }));
}

async function resetPassword(user, btn) {
  const choice = await confirmModal({
    title: t('admin.reset.title', { name: user.username }),
    body: t('admin.reset.body', { pw: DEFAULT_PASSWORD }),
    actions: [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('admin.reset.confirm'), value: 'reset', style: 'primary' },
    ],
  });
  if (choice !== 'reset') return;
  btn.disabled = true;
  try {
    await api(`/api/users/${user.id}/reset-password`, { method: 'POST' });
  } catch (err) {
    btn.disabled = false;
    return toast(err instanceof ApiError ? err.message : t('admin.reset.failedLocal'), 'err');
  }
  user.requires_password_change = true;
  renderAdminList();
  toast(t('admin.reset.done', { name: user.username }));
}

async function deleteUser(user) {
  const choice = await confirmModal({
    title: t('admin.delete.title', { name: user.username }),
    body: t('admin.delete.body'),
    actions: [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('admin.delete.confirm'), value: 'delete', style: 'danger' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    await api(`/api/users/${user.id}`, { method: 'DELETE' });
  } catch (err) {
    return toast(err instanceof ApiError ? err.message : t('admin.delete.failedLocal'), 'err');
  }
  adminState.users = adminState.users.filter((u) => u.id !== user.id);
  if (adminState.openId === user.id) adminState.openId = null;
  renderAdminList();
  toast(t('admin.delete.done', { name: user.username }));
}

async function createUser(username) {
  try {
    const { user } = await api('/api/users', { method: 'POST', body: { username } });
    const created = {
      id: user.id,
      username: user.username,
      role: user.role,
      requires_password_change: true,
      // The endpoint doesn't echo created_at back, and the account is
      // milliseconds old — stamping it here beats a blank date or a refetch.
      created_at: user.created_at ?? Date.now(),
    };
    adminState.users.push(created);
    adminState.users.sort((a, b) => a.username.localeCompare(b.username));
    renderAdminList();
    toast(t('admin.create.done', { name: created.username, pw: DEFAULT_PASSWORD }));
  } catch (err) {
    const message = err instanceof ApiError && err.code === 'USERNAME_TAKEN'
      ? t('auth.err.taken')
      : (err.message || t('admin.create.failed'));
    toast(message, 'err');
  }
}

function showCreateForm(show) {
  const form = document.getElementById('admin-create-form');
  const toggle = document.getElementById('admin-new-toggle');
  form.classList.toggle('hidden', !show);
  form.classList.toggle('flex', show);
  toggle.setAttribute('aria-expanded', String(show));
  if (show) document.getElementById('admin-create-username').focus();
}

function hideCreateForm() {
  const input = document.getElementById('admin-create-username');
  if (input) input.value = '';
  showCreateForm(false);
}

function wireAdminPanel() {
  document.getElementById('admin-search').addEventListener('input', (e) => {
    adminState.filter = e.target.value;
    // A filtered-out row shouldn't stay open behind the filter.
    adminState.openId = null;
    renderAdminList();
  });

  document.getElementById('admin-new-toggle').addEventListener('click', () => {
    const hidden = document.getElementById('admin-create-form').classList.contains('hidden');
    showCreateForm(hidden);
  });
  document.getElementById('admin-create-cancel').addEventListener('click', hideCreateForm);

  document.getElementById('admin-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('admin-create-username');
    const username = input.value.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      return toast(t('auth.err.badUsername'), 'err');
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    await createUser(username);
    btn.disabled = false;
    hideCreateForm();
  });
}


/* ── boot ───────────────────────────────────────────────────── */

export async function initAuth() {
  // The greeter fronts the sheet the way a lock screen holds an avatar. It
  // tracks the cursor until an auth outcome pins its expression.
  greeter = initFaceCard('auth-face', { compact: true }) || null;
  wireLoginForm();
  wireChangePasswordForm();
  wireUserMenu();
  wireAdminPanel();
  initTour();

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
    await finishLogin(user);
  } catch (err) {
    // 401 here is expected when signed out; the handler already showed login,
    // but call it explicitly in case the request failed some other way.
    showAuthScreen('login');
  }

  // Drawn from JS, so out of the DOM walker's reach.
  on('locale:changed', () => {
    if (state.user) renderNavbar();
    if (document.getElementById('dlg-admin').open) renderAdminList();
  });

  await ready;
  return state;
}
