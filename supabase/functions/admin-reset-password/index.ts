// POST { target_user_id } — an admin (or the global admin) resets a Normal
// User's password back to the default ('bentoos') and flags the account so
// the user is forced through /change-password on next login.
//
// RBAC constraints enforced here (RBAC §2):
//   * caller must be role 'admin' or 'global_admin'
//   * target must be role 'user' — admins can never reset other admins or
//     the global admin
//   * response contains no PII (no emails, no IPs)
//
// Custom rate limiting (Auth §1): 5 resets per admin per hour, fail-closed.

import { corsHeaders, errorResponse, getCaller, json, serviceClient, withinRateLimit } from '../_shared/mod.ts';

const DEFAULT_PASSWORD = 'bentoos';
const MAX_RESETS_PER_HOUR = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'METHOD', 'POST only');

  const caller = await getCaller(req);
  if (!caller) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in required');
  if (caller.role !== 'admin' && caller.role !== 'global_admin') {
    return errorResponse(403, 'FORBIDDEN', 'Admin role required');
  }

  if (!(await withinRateLimit(`pw-reset:${caller.id}`, MAX_RESETS_PER_HOUR, 3600))) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many password resets — try again later');
  }

  let targetUserId: string;
  try {
    const body = await req.json();
    targetUserId = String(body.target_user_id ?? '');
  } catch {
    return errorResponse(400, 'BAD_JSON', 'Request body is not valid JSON');
  }
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) {
    return errorResponse(400, 'VALIDATION', 'target_user_id (uuid) is required');
  }

  const svc = serviceClient();

  const { data: targetRole } = await svc
    .from('user_roles')
    .select('role')
    .eq('user_id', targetUserId)
    .single();
  if (!targetRole) return errorResponse(404, 'NOT_FOUND', 'User not found');
  if (targetRole.role !== 'user') {
    return errorResponse(403, 'FORBIDDEN', 'Only Normal User passwords can be reset');
  }

  const { error: updateErr } = await svc.auth.admin.updateUserById(targetUserId, {
    password: DEFAULT_PASSWORD,
  });
  if (updateErr) {
    console.error('[admin-reset-password]', updateErr.message);
    return errorResponse(500, 'INTERNAL', 'Password reset failed');
  }

  await svc
    .from('user_roles')
    .update({ requires_password_change: true, updated_at: new Date().toISOString() })
    .eq('user_id', targetUserId);

  return json(200, { ok: true });
});
