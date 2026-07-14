'use strict';

// Break-glass password reset — works for ANY user including the global
// admin, so it must only ever run with the service role key (the recovery
// root of trust; see docs/SUPABASE-MIGRATION.md §9).
//
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/reset-user-password.js <username>
//
// Resets the password to the default ("bentoos") and sets
// requires_password_change, so the next login is forced through the
// /change-password view — same contract as the in-app admin reset.

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_PASSWORD = 'bentoos';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const username = (process.argv[2] || '').trim().toLowerCase();

if (!url || !key || !username) {
  console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/reset-user-password.js <username>');
  process.exit(1);
}

const svc = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: prof, error: findErr } = await svc
    .from('profiles').select('id').eq('username', username).maybeSingle();
  if (findErr) throw findErr;
  if (!prof) {
    console.error(`[reset] no user with username "${username}"`);
    process.exit(1);
  }

  const { error: pwErr } = await svc.auth.admin.updateUserById(prof.id, {
    password: DEFAULT_PASSWORD,
  });
  if (pwErr) throw pwErr;

  const { error: flagErr } = await svc
    .from('user_roles')
    .update({ requires_password_change: true, updated_at: new Date().toISOString() })
    .eq('user_id', prof.id);
  if (flagErr) throw flagErr;

  console.log(`[reset] "${username}" password reset to "${DEFAULT_PASSWORD}" — a new password is forced at next login`);
}

main().catch((e) => {
  console.error('[reset] failed:', e.message || e);
  process.exit(1);
});
