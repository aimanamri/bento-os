// POST { target_user_id } — the global admin permanently deletes another
// user's account. auth.admin.deleteUser() removes the auth.users row, and
// every ON DELETE CASCADE FK (profiles, user_roles, entries, prompts,
// snippets, user_skills) hard-deletes with it — same GDPR/PDPA guarantee as
// the self-service delete-account function.
//
// RBAC constraints (RBAC §2): global_admin only; never self, never another
// global_admin (the singleton superuser must always exist).
//
// Custom rate limiting (Auth §1): 10 deletions per admin per hour, fail-closed.

import { corsHeaders, errorResponse, getCaller, json, serviceClient, withinRateLimit } from '../_shared/mod.ts';

const MAX_DELETES_PER_HOUR = 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'METHOD', 'POST only');

  const caller = await getCaller(req);
  if (!caller) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in required');
  if (caller.role !== 'global_admin') {
    return errorResponse(403, 'FORBIDDEN', 'Only the global admin can delete users');
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
  if (targetUserId === caller.id) {
    return errorResponse(403, 'FORBIDDEN', 'You cannot delete your own account here');
  }

  if (!(await withinRateLimit(`user-delete:${caller.id}`, MAX_DELETES_PER_HOUR, 3600))) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many deletions — try again later');
  }

  const svc = serviceClient();

  const { data: targetRole } = await svc.from('user_roles').select('role').eq('user_id', targetUserId).single();
  if (!targetRole) return errorResponse(404, 'NOT_FOUND', 'User not found');
  if (targetRole.role === 'global_admin') {
    return errorResponse(403, 'FORBIDDEN', 'The global admin account cannot be deleted');
  }

  const { error } = await svc.auth.admin.deleteUser(targetUserId); // hard delete, cascades everywhere
  if (error) {
    console.error('[admin-delete-user]', error.message);
    return errorResponse(500, 'INTERNAL', 'Account deletion failed');
  }

  return json(200, { ok: true });
});
