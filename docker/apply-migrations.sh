#!/bin/sh
# Bento OS — apply supabase/migrations/*.sql to the self-hosted database.
#
# Runs as a one-shot compose service after BOTH db and auth report healthy.
# The ordering is not optional: every migration references auth.users (foreign
# keys, and the on_auth_user_created trigger), and that table does not exist
# until GoTrue has run its own migrations on first boot. Applying these before
# auth is up fails with `relation "auth.users" does not exist`.
#
# Idempotent: applied files are recorded in public.schema_migrations, so
# `docker compose up` on an existing volume is a no-op rather than a pile of
# "type already exists" errors.

set -eu

PSQL="psql -v ON_ERROR_STOP=1 -h ${PGHOST:-db} -U ${PGUSER:-supabase_admin} -d ${PGDATABASE:-postgres}"

echo "[migrate] waiting for the database to accept connections"
until pg_isready -h "${PGHOST:-db}" -U "${PGUSER:-supabase_admin}" -q; do
  sleep 1
done

# GoTrue creates auth.users during its own startup migrations. Its healthcheck
# can pass a moment before the table is committed, so confirm it directly.
echo "[migrate] waiting for auth.users (created by GoTrue)"
i=0
until [ "$($PSQL -tAc "select to_regclass('auth.users') is not null")" = "t" ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "[migrate] FAILED: auth.users never appeared — check 'docker compose logs auth'" >&2
    exit 1
  fi
  sleep 2
done

$PSQL -q -c "create table if not exists public.schema_migrations (
               version    text primary key,
               applied_at timestamptz not null default now()
             );"

applied=0
skipped=0
for f in /migrations/*.sql; do
  [ -e "$f" ] || { echo "[migrate] no migration files found at /migrations" >&2; exit 1; }
  version="$(basename "$f")"

  if [ "$($PSQL -tAc "select 1 from public.schema_migrations where version = '$version'")" = "1" ]; then
    echo "[migrate] skip    $version"
    skipped=$((skipped + 1))
    continue
  fi

  echo "[migrate] apply   $version"
  # Each file runs in a single transaction: a failure half-way leaves no
  # partial schema behind, and the version is only recorded on success.
  $PSQL -q -1 -f "$f"
  $PSQL -q -c "insert into public.schema_migrations (version) values ('$version');"
  applied=$((applied + 1))
done

echo "[migrate] done — $applied applied, $skipped already present"
