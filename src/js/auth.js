// Authentication & RBAC UI (Supabase Auth).
//
// Flow (goal spec §1/§2/§5):
//   * signed out            → full-screen login portal (User ID + password)
//   * requires_password_change (default credentials, or after an admin
//     reset) → forced #/change-password view; the dashboard is unreachable
//     until a new password is set
//   * signed in             → app shell shown, navbar displays the username,
//     normal users land on their LogBook workspace
//
// Roles come from public.user_roles (never client-writable — see the
// migration: no INSERT/UPDATE policies exist, RPCs + Edge Functions only).

import { sb, usernameToEmail, validUsername } from './supabase.js';
import { toast, confirmModal, announce } from './ui.js';
import { initFaceCard } from './face-card.js';
import { initTour } from './tour.js';

const DEFAULT_PASSWORD = 'bentoos';
const PASSWORD_MIN = 8;
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

function startClock() {
  const time = document.getElementById('auth-clock-time');
  const date = document.getElementById('auth-clock-date');
  if (!time || !date) return;

  const tick = () => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    date.textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
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

const state = {
  user: null,
  username: null,
  role: null, // 'global_admin' | 'admin' | 'user'
};

export function getAuthState() {
  return state;
}

/* ── view switching ─────────────────────────────────────────── */

let cpForced = false; // forced rotation traps; voluntary change can go back

function showAuthScreen(view, { forced = false } = {}) {
  frame.style.display = 'none';
  authScreen.style.display = 'flex';
  const isLogin = view === 'login';
  cpForced = !isLogin && forced;
  document.getElementById('cp-cancel').classList.toggle('hidden', isLogin || forced);
  loginForm.classList.toggle('hidden', !isLogin);
  loginForm.classList.toggle('flex', isLogin);
  cpForm.classList.toggle('hidden', isLogin);
  cpForm.classList.toggle('flex', !isLogin);
  // The change-password view shares this sheet, so it gets the same greeter —
  // it just isn't a greeting at that point.
  authSub.textContent = isLogin ? 'Sign in to your workspace' : 'One more step';
  greeter?.release();
  startClock();
  // Dedicated route for the forced flow — tokens never ride in the URL.
  location.hash = isLogin ? '#/login' : '#/change-password';
  (isLogin ? document.getElementById('auth-username') : document.getElementById('cp-new')).focus();
}

function showApp() {
  stopClock();
  clearTimeout(flinchTimer);
  authScreen.style.display = 'none';
  frame.style.display = '';
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

/* ── post-login: load profile + role, gate on password change ── */

async function loadIdentity(user) {
  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    sb.from('profiles').select('username').eq('id', user.id).maybeSingle(),
    sb.from('user_roles').select('role, requires_password_change').eq('user_id', user.id).maybeSingle(),
  ]);
  state.user = user;
  state.username = profile?.username || user.user_metadata?.username || 'user';
  state.role = roleRow?.role || 'user';
  return { requiresPasswordChange: !!roleRow?.requires_password_change };
}

function renderNavbar() {
  const chip = document.getElementById('nav-user');
  document.getElementById('nav-username').textContent = state.username;
  const badge = document.getElementById('nav-role-badge');
  if (state.role === 'global_admin') badge.textContent = 'global admin';
  else if (state.role === 'admin') badge.textContent = 'admin';
  else badge.textContent = '';
  badge.classList.toggle('hidden', state.role === 'user');
  document.getElementById('menu-admin').classList.toggle('hidden', state.role === 'user');
  // GDPR self-deletion for everyone except the singleton global admin
  document.getElementById('menu-delete').classList.toggle('hidden', state.role === 'global_admin');
  chip.classList.remove('hidden');
}

/* ── login / signup ─────────────────────────────────────────── */

let signupMode = false;
let resolveReady; // resolves initAuth()'s promise once fully authenticated

function friendlyAuthError(error) {
  const msg = error?.message || '';
  if (/invalid login credentials/i.test(msg)) return 'Wrong User ID or password';
  if (/already registered/i.test(msg)) return 'That User ID is taken';
  if (/database error saving/i.test(msg)) return 'That User ID is taken';
  if (/rate limit/i.test(msg)) return 'Too many attempts — wait a moment and try again';
  return msg || 'Sign-in failed';
}

async function finishLogin(user) {
  const { requiresPasswordChange } = await loadIdentity(user);
  if (requiresPasswordChange) {
    // Mandatory security flow: intercept routing before the dashboard.
    showAuthScreen('change-password', { forced: true });
    return;
  }
  // Coming off the lock screen, let the greeter register the win before the
  // workspace takes over. A restored session has no lock screen to hold.
  if (lockVisible()) {
    greeter?.setState('ok');
    authSub.textContent = `Welcome back, ${state.username}`;
    await new Promise((resolve) => setTimeout(resolve, SUCCESS_HOLD_MS));
  }
  renderNavbar();
  showApp();
  announce(`Signed in as ${state.username}`);
  resolveReady?.();
}

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

    if (!validUsername(username)) {
      return rejectAuth(loginError, 'User ID: 2–32 letters, digits, dot, dash or underscore');
    }
    if (!password) return rejectAuth(loginError, 'Password is required');
    if (signupMode && password.length < PASSWORD_MIN) {
      return rejectAuth(loginError, `Password needs at least ${PASSWORD_MIN} characters`);
    }

    submitBtn.disabled = true;
    try {
      // Supabase Auth's built-in rate limiting covers these endpoints.
      let user;
      if (signupMode) {
        const { data, error } = await sb.auth.signUp({
          email: usernameToEmail(username),
          password,
          options: { data: { username: username.toLowerCase() } },
        });
        if (error) throw error;
        if (!data.session) {
          return rejectAuth(loginError, 'Account created but sign-in is pending — email confirmations must be disabled for this app (see docs/SUPABASE-MIGRATION.md)');
        }
        user = data.user;
      } else {
        const { data, error } = await sb.auth.signInWithPassword({
          email: usernameToEmail(username),
          password,
        });
        if (error) throw error;
        user = data.user;
      }
      loginForm.reset();
      await finishLogin(user);
    } catch (err) {
      rejectAuth(loginError, friendlyAuthError(err));
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ── change password (forced after default credentials) ────── */

function wireChangePasswordForm() {
  document.getElementById('cp-cancel').addEventListener('click', () => {
    if (cpForced) return; // defense in depth: the button is hidden when forced
    cpForm.reset();
    setError(cpError, '');
    showApp();
  });

  cpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(cpError, '');
    const next = document.getElementById('cp-new').value;
    const confirm = document.getElementById('cp-confirm').value;

    if (next.length < PASSWORD_MIN) {
      return rejectAuth(cpError, `Password needs at least ${PASSWORD_MIN} characters`);
    }
    if (next === DEFAULT_PASSWORD) {
      return rejectAuth(cpError, 'The default password cannot be reused');
    }
    if (next !== confirm) return rejectAuth(cpError, 'Passwords do not match');

    const btn = document.getElementById('cp-submit');
    btn.disabled = true;
    try {
      const { error } = await sb.auth.updateUser({ password: next });
      if (error) throw error;
      const { error: rpcErr } = await sb.rpc('mark_password_changed');
      if (rpcErr) throw rpcErr;
      cpForm.reset();
      toast('Password updated', 'info');
      const { data } = await sb.auth.getUser();
      await finishLogin(data.user);
    } catch (err) {
      rejectAuth(cpError, friendlyAuthError(err));
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
    await sb.auth.signOut();
    location.reload(); // clean slate: all module state is per-user
  });

  document.getElementById('menu-changepw').addEventListener('click', () => {
    closeMenu();
    showAuthScreen('change-password');
  });

  document.getElementById('menu-admin').addEventListener('click', () => {
    closeMenu();
    openAdminPanel();
  });

  // GDPR/PDPA right to be forgotten: hard delete of account + all data.
  document.getElementById('menu-delete').addEventListener('click', async () => {
    closeMenu();
    const choice = await confirmModal({
      title: 'Delete your account?',
      body: 'This permanently erases your account, every LogBook entry and every prompt. There is no undo and nothing is retained (GDPR/PDPA hard delete).',
      actions: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete everything', value: 'delete', style: 'danger' },
      ],
    });
    if (choice !== 'delete') return;
    const { error } = await sb.functions.invoke('delete-account', { body: {} });
    if (error) return toast('Account deletion failed — try again later', 'err');
    toast('Account deleted');
    await sb.auth.signOut();
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

const ROLE_LABEL = { global_admin: 'global admin', admin: 'admin', user: 'user' };
const ROLE_ORDER = ['global_admin', 'admin', 'user'];
const ROLE_SECTION = { global_admin: 'Global admin', admin: 'Admins', user: 'Users' };

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
  list.textContent = 'Loading…';

  const [{ data: profiles, error: pErr }, { data: roles }] = await Promise.all([
    // created_at has been on the row since the first migration; admins already
    // pass profiles_select, so surfacing it costs nothing but asking for it.
    sb.from('profiles').select('id, username, created_at').order('username'),
    sb.from('user_roles').select('user_id, role, requires_password_change'),
  ]);
  if (pErr) {
    list.textContent = 'Could not load users.';
    return;
  }
  const roleById = new Map((roles || []).map((r) => [r.user_id, r]));
  adminState.users = profiles.map((p) => ({
    id: p.id,
    username: p.username,
    created_at: p.created_at,
    role: roleById.get(p.id)?.role || 'user',
    requires_password_change: !!roleById.get(p.id)?.requires_password_change,
  }));
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
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
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
  const isGlobalAdmin = state.role === 'global_admin';

  // Any admin, but only on normal users, and never on themselves.
  if (u.role === 'user' && !isSelf) {
    actions.push({
      label: 'Reset password',
      button: 'Reset',
      description: `Sets their password back to the default and forces a change at their next sign-in.`,
      run: (btn) => resetPassword(u, btn),
    });
  }
  if (isGlobalAdmin && u.role === 'user') {
    actions.push({
      label: 'Make admin',
      button: 'Promote',
      description: 'Lets them create users and reset passwords. They still cannot read anyone else\'s notes.',
      run: (btn) => changeRole(u, 'promote', btn),
    });
  }
  if (isGlobalAdmin && u.role === 'admin') {
    actions.push({
      label: 'Remove admin',
      button: 'Demote',
      description: 'Returns them to a normal user. Their own entries and prompts are untouched.',
      run: (btn) => changeRole(u, 'demote', btn),
    });
  }
  if (isGlobalAdmin && u.role !== 'global_admin' && !isSelf) {
    actions.push({
      danger: true,
      label: 'Delete account',
      button: 'Delete…',
      description: 'Erases the account and every entry, prompt and snippet they own. This cannot be undone.',
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
  count.textContent = total ? `${total} ${total === 1 ? 'person' : 'people'}` : '';

  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'py-6 text-center text-sm text-ink-muted';
    empty.textContent = total === 0 ? 'No users yet.' : `Nothing matches “${adminState.filter.trim()}”.`;
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
    heading.append(ROLE_SECTION[role]);
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
  pill.textContent = ROLE_LABEL[role] || role;
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
    you.textContent = 'you';
    // Half the actions are withheld on your own row; say so rather than
    // leaving an admin to wonder why it does nothing.
    you.title = 'You cannot change your own role or delete your own account here';
    head.appendChild(you);
  }

  if (u.requires_password_change) {
    const flag = document.createElement('span');
    flag.className = 'rounded-full border border-warn-hue/55 px-2 py-0.5 text-[11px] text-warn-hue';
    flag.title = 'Must change password at next sign-in';
    flag.textContent = 'reset pending';
    head.appendChild(flag);
  }

  const joined = joinedLabel(u.created_at);
  if (joined) {
    const when = document.createElement('span');
    when.className = 'whitespace-nowrap text-[11px] tabular-nums text-ink-muted';
    when.title = 'Account created';
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
  const { error } = await sb.rpc(promote ? 'promote_to_admin' : 'demote_to_user', {
    target_user_id: u.id,
  });
  if (error) {
    btn.disabled = false;
    return toast(promote ? 'Promotion failed' : 'Demotion failed', 'err');
  }
  u.role = promote ? 'admin' : 'user';
  // The permitted actions change with the role, so re-render rather than patch.
  renderAdminList();
  toast(promote ? `${u.username} is now an admin` : `${u.username} is a normal user again`);
}

async function resetPassword(profile, btn) {
  const choice = await confirmModal({
    title: `Reset ${profile.username}'s password?`,
    body: `Their password returns to the default ("${DEFAULT_PASSWORD}") and they must choose a new one at next login.`,
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Reset password', value: 'reset', style: 'primary' },
    ],
  });
  if (choice !== 'reset') return;
  btn.disabled = true;
  // Sensitive action → Edge Function with custom rate limiting (Auth §1).
  const { error } = await sb.functions.invoke('admin-reset-password', {
    body: { target_user_id: profile.id },
  });
  btn.disabled = false;
  if (error) return toast('Reset failed — you may be rate limited', 'err');
  profile.requires_password_change = true;
  renderAdminList();
  toast(`${profile.username}'s password was reset to the default`);
}

async function deleteUser(profile) {
  const choice = await confirmModal({
    title: `Delete ${profile.username}?`,
    body: 'This permanently erases their account and every LogBook entry, prompt and snippet they own. There is no undo.',
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Delete everything', value: 'delete', style: 'danger' },
    ],
  });
  if (choice !== 'delete') return;
  const { error } = await sb.functions.invoke('admin-delete-user', {
    body: { target_user_id: profile.id },
  });
  if (error) return toast('Deletion failed — you may be rate limited', 'err');
  adminState.users = adminState.users.filter((u) => u.id !== profile.id);
  if (adminState.openId === profile.id) adminState.openId = null;
  renderAdminList();
  toast(`${profile.username} was deleted`);
}

async function createUser(username) {
  const { data, error } = await sb.functions.invoke('admin-create-user', {
    body: { username },
  });
  if (error) {
    let message = 'Account creation failed';
    try {
      const payload = await error.context?.json?.();
      if (payload?.error?.code === 'USERNAME_TAKEN') message = 'That User ID is taken';
      else if (payload?.error?.message) message = payload.error.message;
    } catch (e) {
      /* fall back to the generic message */
    }
    toast(message, 'err');
    return;
  }
  const created = {
    id: data.user.id,
    username: data.user.username,
    role: data.user.role,
    requires_password_change: true,
    // The Edge Function doesn't echo created_at back, and the account is
    // milliseconds old — stamping it here beats a blank date or a refetch.
    created_at: data.user.created_at ?? new Date().toISOString(),
  };
  adminState.users.push(created);
  adminState.users.sort((a, b) => a.username.localeCompare(b.username));
  renderAdminList();
  toast(`${created.username} created — default password is "${DEFAULT_PASSWORD}"`);
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
    if (!validUsername(username)) {
      return toast('User ID: 2–32 letters, digits, dot, dash or underscore', 'err');
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    await createUser(username);
    btn.disabled = false;
    hideCreateForm();
  });
}

/* ── pre-auth tour ──────────────────────────────────────────── */

// Lives in tour.js: the dock pills and the "New here?" link each open the
// dialog on their own tab, since logged out there is no tool to restore.

/* ── boot ───────────────────────────────────────────────────── */

/**
 * Gate the app behind auth. Resolves once the user is signed in AND has
 * cleared any forced password change; main.js awaits this before loading
 * any data modules.
 */
export async function initAuth() {
  // The greeter fronts the sheet the way a lock screen holds an avatar. It
  // tracks the cursor until an auth outcome pins its expression.
  greeter = initFaceCard('auth-face', { compact: true }) || null;
  wireLoginForm();
  wireChangePasswordForm();
  wireUserMenu();
  wireAdminPanel();
  initTour();

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.reload();
  });

  const ready = new Promise((resolve) => (resolveReady = resolve));

  const { data } = await sb.auth.getSession().catch(() => ({ data: null }));
  if (data?.session?.user) {
    await finishLogin(data.session.user);
  } else {
    showAuthScreen('login');
  }
  await ready;
  return state;
}
