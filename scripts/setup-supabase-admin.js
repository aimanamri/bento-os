'use strict';

// One-time bootstrap of the singleton Global Admin (RBAC §2).
//
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/setup-supabase-admin.js
//
// Creates auth user admin@bentoos.local (username "admin", password
// "bentoos"), promotes its role row to global_admin, and sets
// requires_password_change so the first login is forced through the
// /change-password flow before the dashboard is reachable.
//
// Idempotent: safe to re-run; it will not duplicate the user and it will
// refuse to create a second global admin (the DB unique index also forbids it).

const { createClient } = require('@supabase/supabase-js');

const AUTH_EMAIL_DOMAIN = 'bentoos.local'; // must match src/js/supabase.js
const ADMIN_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'bentoos';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const svc = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const email = `${ADMIN_USERNAME}@${AUTH_EMAIL_DOMAIN}`;

  const { data: existingGlobal } = await svc
    .from('user_roles')
    .select('user_id')
    .eq('role', 'global_admin')
    .maybeSingle();

  let userId;
  if (existingGlobal) {
    userId = existingGlobal.user_id;
    console.log('[setup] global admin already exists — leaving credentials untouched');
  } else {
    const { data: created, error } = await svc.auth.admin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true, // synthesized address — nothing to verify
      user_metadata: { username: ADMIN_USERNAME },
    });
    if (error) {
      // user may exist from a previous partial run
      if (!/already/i.test(error.message)) throw error;
      const { data: prof } = await svc
        .from('profiles').select('id').eq('username', ADMIN_USERNAME).single();
      if (!prof) throw error;
      userId = prof.id;
    } else {
      userId = created.user.id;
    }

    const { error: roleErr } = await svc
      .from('user_roles')
      .update({ role: 'global_admin', requires_password_change: true })
      .eq('user_id', userId);
    if (roleErr) throw roleErr;
    console.log(`[setup] global admin created (username: ${ADMIN_USERNAME}, password: ${DEFAULT_PASSWORD})`);
    console.log('[setup] first login will force a password change before the dashboard loads');
  }
}

main().catch((e) => {
  console.error('[setup] failed:', e.message || e);
  process.exit(1);
});
