// Bento OS — Edge Functions router for the self-hosted stack.
//
// On hosted Supabase every function is deployed and routed for you. The
// self-hosted `supabase/edge-runtime` image instead boots ONE "main service"
// that receives all traffic and spawns a per-request worker for the function
// named in the path:
//
//   POST /admin-create-user  →  /home/deno/functions/admin-create-user/index.ts
//
// The gateway strips the /functions/v1 prefix before we see the request, so
// the first path segment is the function name.
//
// This router deliberately does NOT verify the caller's JWT. Each function
// authenticates for itself via getCaller() in _shared/mod.ts, which both
// resolves the user and loads their app role — a check the router could not
// do on its own without duplicating the RBAC rules.

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const FUNCTIONS_ROOT = '/home/deno/functions';
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// Forwarded into every worker: _shared/mod.ts builds its service-role client
// from these. SUPABASE_URL points at the gateway by its in-network name, so a
// function calling back into PostgREST/GoTrue stays inside the compose
// network and never depends on the host port mapping.
const envVars = [
  ['SUPABASE_URL', Deno.env.get('SUPABASE_URL')!],
  ['SUPABASE_ANON_KEY', Deno.env.get('SUPABASE_ANON_KEY')!],
  ['SUPABASE_SERVICE_ROLE_KEY', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!],
  ['SUPABASE_DB_URL', Deno.env.get('SUPABASE_DB_URL')!],
];

function problem(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { code: 'GATEWAY', message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const { pathname } = new URL(req.url);
  const name = pathname.split('/').filter(Boolean)[0] ?? '';

  // Reject anything that isn't a plain function name before it can become a
  // path traversal into the container filesystem.
  if (!NAME_RE.test(name)) {
    return problem(400, 'Missing or malformed function name');
  }

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${FUNCTIONS_ROOT}/${name}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 120_000,
      noModuleCache: false,
      importMapPath: null,
      envVars,
    });
    return await worker.fetch(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[functions] ${name}: ${message}`);
    // A missing directory is the overwhelmingly common cause here — a
    // function that was never created, or a typo in the invoke() call.
    return problem(404, `Function "${name}" is not deployed`);
  }
});
