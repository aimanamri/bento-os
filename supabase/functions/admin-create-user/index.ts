// POST { username } — an admin (or the global admin) creates a new user
// account with the default password ('bentoos'). auth.admin.createUser()
// fires the same on_auth_user_created trigger as self-signup, so the new
// account gets its profile/role row and seeded welcome content for free;
// this function only has to flag the forced password change afterward.
//
// RBAC constraints enforced here (RBAC §2):
//   * caller must be role 'admin' or 'global_admin'
//   * response contains no PII (no emails, no IPs)
//
// Custom rate limiting (Auth §1): 20 creations per admin per hour, fail-closed.

import { corsHeaders, errorResponse, getCaller, json, serviceClient, withinRateLimit } from '../_shared/mod.ts';

const DEFAULT_PASSWORD = 'bentoos';
const MAX_CREATES_PER_HOUR = 20;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/;
const AUTH_EMAIL_DOMAIN = 'bentoos.local';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'METHOD', 'POST only');

  const caller = await getCaller(req);
  if (!caller) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in required');
  if (caller.role !== 'admin' && caller.role !== 'global_admin') {
    return errorResponse(403, 'FORBIDDEN', 'Admin role required');
  }

  if (!(await withinRateLimit(`user-create:${caller.id}`, MAX_CREATES_PER_HOUR, 3600))) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many accounts created — try again later');
  }

  let username: string;
  try {
    const body = await req.json();
    username = String(body.username ?? '').trim().toLowerCase();
  } catch {
    return errorResponse(400, 'BAD_JSON', 'Request body is not valid JSON');
  }
  if (!USERNAME_RE.test(username)) {
    return errorResponse(400, 'VALIDATION', 'User ID: 2-32 letters, digits, dot, dash or underscore');
  }

  const svc = serviceClient();

  const { data: existing } = await svc.from('profiles').select('id').eq('username', username).maybeSingle();
  if (existing) return errorResponse(409, 'USERNAME_TAKEN', 'That User ID is taken');

  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email: `${username}@${AUTH_EMAIL_DOMAIN}`,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: { username },
  });
  if (createErr || !created?.user) {
    console.error('[admin-create-user]', createErr?.message);
    if (/already registered|duplicate/i.test(createErr?.message ?? '')) {
      return errorResponse(409, 'USERNAME_TAKEN', 'That User ID is taken');
    }
    return errorResponse(500, 'INTERNAL', 'Account creation failed');
  }

  await svc
    .from('user_roles')
    .update({ requires_password_change: true, updated_at: new Date().toISOString() })
    .eq('user_id', created.user.id);

  return json(200, {
    ok: true,
    user: { id: created.user.id, username, role: 'user', requires_password_change: true },
  });
});
