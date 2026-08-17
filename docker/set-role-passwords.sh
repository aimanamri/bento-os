#!/bin/sh
# Bento OS — give the stack's service roles a password.
#
# supabase/postgres already CREATES every role the stack needs (anon,
# authenticated, service_role, authenticator, supabase_auth_admin, …), the auth
# schema, and the auth.uid() / auth.role() helpers that every RLS policy in
# supabase/migrations/ is written against. What it does NOT do is give the two
# service roles a password — on the hosted product each service gets its own
# generated secret, so the image leaves rolpassword NULL:
#
#   authenticator        no password  →  PostgREST cannot connect
#   supabase_auth_admin  no password  →  GoTrue cannot connect
#
# Without this both die on boot with `password authentication failed`.
#
# WHY THIS IS A COMPOSE SERVICE AND NOT A /docker-entrypoint-initdb.d SCRIPT:
# the obvious approach is to drop this in that directory, but it cannot work
# from a bind mount. Docker Desktop presents mounted files as executable no
# matter their mode on the host, so the entrypoint takes its `[ -x ]` branch
# and tries to exec the file — which fails, because the same mount is noexec:
#
#   /docker-entrypoint-initdb.d/zz-roles.sh: /bin/bash: bad interpreter: Permission denied
#
# Running it as its own one-shot service, invoked as `sh <script>`, sidesteps
# the exec bit entirely and behaves identically on macOS, Linux and Windows.
#
# It also makes the step idempotent and re-runnable: initdb scripts only ever
# fire on an empty data directory, whereas this runs on every `up`, so
# rotating the service-role password no longer means recreating the volume.

set -eu

echo "[db-init] waiting for the database to accept connections"
until pg_isready -h "${PGHOST:-db}" -U "${PGUSER:-supabase_admin}" -q; do
  sleep 1
done

psql -v ON_ERROR_STOP=1 \
     -h "${PGHOST:-db}" -U "${PGUSER:-supabase_admin}" -d "${PGDATABASE:-postgres}" \
     -v pw="${SERVICE_ROLE_PASSWORD:?SERVICE_ROLE_PASSWORD is required}" <<'EOSQL'
-- The password is carried into the DO block through a session GUC rather than
-- interpolated into it: psql does not expand :'pw' inside a dollar-quoted
-- body, and building the statement by shell interpolation would break on any
-- password containing a quote.
select set_config('bento.pw', :'pw', false);

do $$
declare
  r text;
begin
  foreach r in array array[
    'supabase_auth_admin',      -- GoTrue: owns and migrates the auth schema
    'authenticator',            -- PostgREST: the role it logs in as
    'postgres',                 -- so `psql -U postgres` works from the host
    'supabase_storage_admin',
    'supabase_functions_admin'
  ] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter role %I with login password %L', r, current_setting('bento.pw'));
      raise notice '[db-init] password set for role %', r;
    end if;
  end loop;
end
$$;

-- PostgREST authenticates as `authenticator`, a role with no rights of its own,
-- then SET LOCAL ROLE's into one of these per request based on the JWT `role`
-- claim. That switch is what puts the RLS policies in charge of every read and
-- write. Already granted by the image; repeated so the dependency is explicit.
grant anon, authenticated, service_role to authenticator;
EOSQL

echo "[db-init] service role passwords set"
