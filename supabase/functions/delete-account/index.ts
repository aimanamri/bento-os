// POST {} — GDPR/PDPA "right to be forgotten": the authenticated caller
// permanently deletes their own account. auth.admin.deleteUser() removes the
// auth.users row, and every ON DELETE CASCADE FK (profiles, user_roles,
// entries, prompts, snippets) hard-deletes with it — no soft-delete anywhere,
// and no PII is retained.
//
// The global admin cannot self-delete: the singleton superuser must exist.

import { corsHeaders, errorResponse, getCaller, json, serviceClient, withinRateLimit } from '../_shared/mod.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'METHOD', 'POST only');

  const caller = await getCaller(req);
  if (!caller) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in required');
  if (caller.role === 'global_admin') {
    return errorResponse(403, 'FORBIDDEN', 'The global admin account cannot be deleted');
  }

  if (!(await withinRateLimit(`delete:${caller.id}`, 3, 3600))) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many attempts — try again later');
  }

  const svc = serviceClient();
  const { error } = await svc.auth.admin.deleteUser(caller.id); // hard delete
  if (error) {
    console.error('[delete-account]', error.message);
    return errorResponse(500, 'INTERNAL', 'Account deletion failed');
  }

  return json(200, { ok: true });
});
