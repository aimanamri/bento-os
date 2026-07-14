// Shared helpers for Bento OS Edge Functions: caller auth, role checks,
// and custom rate limiting (backed by public.bump_rate_limit).

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

/** Service-role client — bypasses RLS. Never expose its results wholesale. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

export interface Caller {
  id: string;
  role: 'global_admin' | 'admin' | 'user';
}

/** Resolve the calling user from the request JWT and load their app role. */
export async function getCaller(req: Request): Promise<Caller | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const svc = serviceClient();
  const { data: userData, error } = await svc.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: roleRow } = await svc
    .from('user_roles')
    .select('role')
    .eq('user_id', userData.user.id)
    .single();
  if (!roleRow) return null;

  return { id: userData.user.id, role: roleRow.role };
}

/**
 * Fixed-window rate limit. Returns true when the caller is still within
 * budget. Windows and counters live in public.rate_limits (service role).
 */
export async function withinRateLimit(
  key: string,
  maxPerWindow: number,
  windowSeconds: number,
): Promise<boolean> {
  const svc = serviceClient();
  const { data, error } = await svc.rpc('bump_rate_limit', {
    p_key: key,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('[rate-limit]', error.message);
    return false; // fail closed on sensitive endpoints
  }
  return (data as number) <= maxPerWindow;
}
