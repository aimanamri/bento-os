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

const DEFAULT_PASSWORD = 'bentoos';
const PASSWORD_MIN = 8;

const authScreen = document.getElementById('auth-screen');
const frame = document.getElementById('frame');
const loginForm = document.getElementById('auth-login-form');
const cpForm = document.getElementById('auth-cp-form');
const loginError = document.getElementById('auth-error');
const cpError = document.getElementById('cp-error');

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
  // Dedicated route for the forced flow — tokens never ride in the URL.
  location.hash = isLogin ? '#/login' : '#/change-password';
  (isLogin ? document.getElementById('auth-username') : document.getElementById('cp-new')).focus();
}

function showApp() {
  authScreen.style.display = 'none';
  frame.style.display = '';
  if (location.hash === '#/login' || location.hash === '#/change-password') location.hash = '';
}

function setError(el, message) {
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
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
      return setError(loginError, 'User ID: 2–32 letters, digits, dot, dash or underscore');
    }
    if (!password) return setError(loginError, 'Password is required');
    if (signupMode && password.length < PASSWORD_MIN) {
      return setError(loginError, `Password needs at least ${PASSWORD_MIN} characters`);
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
          return setError(loginError, 'Account created but sign-in is pending — email confirmations must be disabled for this app (see docs/SUPABASE-MIGRATION.md)');
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
      setError(loginError, friendlyAuthError(err));
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
      return setError(cpError, `Password needs at least ${PASSWORD_MIN} characters`);
    }
    if (next === DEFAULT_PASSWORD) {
      return setError(cpError, 'The default password cannot be reused');
    }
    if (next !== confirm) return setError(cpError, 'Passwords do not match');

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
      setError(cpError, friendlyAuthError(err));
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

async function openAdminPanel() {
  const dlg = document.getElementById('dlg-admin');
  const list = document.getElementById('admin-user-list');
  list.textContent = 'Loading…';
  dlg.showModal();

  const [{ data: profiles, error: pErr }, { data: roles }] = await Promise.all([
    sb.from('profiles').select('id, username').order('username'),
    sb.from('user_roles').select('user_id, role, requires_password_change'),
  ]);
  if (pErr) {
    list.textContent = 'Could not load users.';
    return;
  }
  const roleById = new Map((roles || []).map((r) => [r.user_id, r]));

  list.textContent = '';
  for (const p of profiles) {
    const r = roleById.get(p.id);
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 rounded-md border border-edge bg-panel-2/50 px-3 py-2';

    const name = document.createElement('span');
    name.className = 'min-w-0 flex-1 truncate text-sm font-medium';
    name.textContent = p.username;
    row.appendChild(name);

    const badge = document.createElement('span');
    badge.className = 'rounded-full border border-edge px-2 py-0.5 text-[11px] text-ink-muted';
    badge.textContent = r?.role === 'global_admin' ? 'global admin' : r?.role || 'user';
    row.appendChild(badge);

    if (r?.requires_password_change) {
      const flag = document.createElement('span');
      flag.className = 'text-[11px] text-warn-hue';
      flag.title = 'Must change password on next login';
      flag.textContent = 'pw reset pending';
      row.appendChild(flag);
    }

    // Admins (and the global admin) may reset Normal User passwords only.
    if (r?.role === 'user' && p.id !== state.user.id) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn text-xs !py-1';
      resetBtn.textContent = 'Reset password';
      resetBtn.addEventListener('click', () => resetPassword(p, resetBtn));
      row.appendChild(resetBtn);
    }

    // Only the global admin can elevate a Normal User to admin.
    if (state.role === 'global_admin' && r?.role === 'user') {
      const promoteBtn = document.createElement('button');
      promoteBtn.className = 'btn text-xs !py-1';
      promoteBtn.textContent = 'Make admin';
      promoteBtn.addEventListener('click', async () => {
        promoteBtn.disabled = true;
        const { error } = await sb.rpc('promote_to_admin', { target_user_id: p.id });
        if (error) {
          promoteBtn.disabled = false;
          return toast('Promotion failed', 'err');
        }
        toast(`${p.username} is now an admin`);
        openAdminPanel(); // re-render
      });
      row.appendChild(promoteBtn);
    }
    if (state.role === 'global_admin' && r?.role === 'admin') {
      const demoteBtn = document.createElement('button');
      demoteBtn.className = 'btn text-xs !py-1';
      demoteBtn.textContent = 'Remove admin';
      demoteBtn.addEventListener('click', async () => {
        demoteBtn.disabled = true;
        const { error } = await sb.rpc('demote_to_user', { target_user_id: p.id });
        if (error) {
          demoteBtn.disabled = false;
          return toast('Demotion failed', 'err');
        }
        toast(`${p.username} is a normal user again`);
        openAdminPanel();
      });
      row.appendChild(demoteBtn);
    }

    list.appendChild(row);
  }
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
  toast(`${profile.username}'s password was reset to the default`);
  openAdminPanel();
}

/* ── boot ───────────────────────────────────────────────────── */

/**
 * Gate the app behind auth. Resolves once the user is signed in AND has
 * cleared any forced password change; main.js awaits this before loading
 * any data modules.
 */
export async function initAuth() {
  wireLoginForm();
  wireChangePasswordForm();
  wireUserMenu();

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
