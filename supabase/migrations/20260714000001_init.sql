-- Bento OS — Supabase (PostgreSQL) schema, v3.
-- Replaces the SQLite schema (server/migrations/001+002). Structural upgrades:
--   * INTEGER PRIMARY KEY  →  UUID DEFAULT gen_random_uuid()
--   * per-user ownership (user_id → auth.users) enforced with RLS
--   * FTS5 shadow tables + triggers  →  generated tsvector column + GIN index
--   * RBAC: user_roles (global_admin / admin / user), max ONE global_admin
--   * GDPR/PDPA: all user data hard-deletes via ON DELETE CASCADE
--   * pgcrypto enabled for gen_random_uuid() and optional column encryption

-- pgcrypto: gen_random_uuid() + pgp_sym_encrypt/decrypt for columns that are
-- later designated highly-sensitive PII (see docs/SUPABASE-MIGRATION.md §7).
create extension if not exists pgcrypto;

-- ═══════════════════════════════════════════════════════════════
-- 1. RBAC: profiles + user_roles
-- ═══════════════════════════════════════════════════════════════

create type public.app_role as enum ('global_admin', 'admin', 'user');

-- Public identity: username only. Deliberately excludes email, IPs and any
-- auth PII so it is safe for admins to read ("data blindness").
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null unique
             check (username ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$'),
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  role                     public.app_role not null default 'user',
  requires_password_change boolean not null default false,
  updated_at               timestamptz not null default now()
);

-- Constraint: only ONE global admin can ever exist.
create unique index one_global_admin
  on public.user_roles (role) where (role = 'global_admin');

-- Role lookups used inside RLS policies must be SECURITY DEFINER: policies on
-- user_roles would otherwise recurse into themselves.
create or replace function public.role_of(uid uuid)
returns public.app_role
language sql stable security definer set search_path = public
as $$ select role from public.user_roles where user_id = uid $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.role_of(auth.uid()) in ('admin', 'global_admin') $$;

create or replace function public.is_global_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.role_of(auth.uid()) = 'global_admin' $$;

-- Every new auth user gets a profile (username from signup metadata) and a
-- 'user' role row. SECURITY DEFINER: fires from GoTrue, not a client session.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1))
  );
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

-- Users see their own profile; admins see all usernames (needed for the user
-- management panel — usernames and roles only, never emails or IPs).
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy user_roles_select on public.user_roles
  for select using (user_id = auth.uid() or public.is_admin());

-- No INSERT/UPDATE/DELETE policies: role changes go through the SECURITY
-- DEFINER RPCs below or the service-role Edge Functions. A client can never
-- write its own role row (self-elevation is impossible).

-- Global admin elevates a Normal User to admin (RBAC §2).
create or replace function public.promote_to_admin(target_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_global_admin() then
    raise exception 'PERMISSION_DENIED: only the global admin can promote users';
  end if;
  update public.user_roles
     set role = 'admin', updated_at = now()
   where user_id = target_user_id and role = 'user';
  if not found then
    raise exception 'INVALID_TARGET: target must be an existing normal user';
  end if;
end;
$$;

-- Global admin can also demote an admin back to a normal user.
create or replace function public.demote_to_user(target_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_global_admin() then
    raise exception 'PERMISSION_DENIED: only the global admin can demote admins';
  end if;
  update public.user_roles
     set role = 'user', updated_at = now()
   where user_id = target_user_id and role = 'admin';
  if not found then
    raise exception 'INVALID_TARGET: target must be an existing admin';
  end if;
end;
$$;

-- Called by the client right after a successful auth.updateUser({password})
-- in the forced /change-password flow. Only clears the caller's own flag.
create or replace function public.mark_password_changed()
returns void
language sql security definer set search_path = public
as $$
  update public.user_roles
     set requires_password_change = false, updated_at = now()
   where user_id = auth.uid();
$$;

revoke all on function public.promote_to_admin(uuid) from public;
revoke all on function public.demote_to_user(uuid) from public;
revoke all on function public.mark_password_changed() from public;
grant execute on function public.promote_to_admin(uuid) to authenticated;
grant execute on function public.demote_to_user(uuid) to authenticated;
grant execute on function public.mark_password_changed() to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2. LogBook entries
-- ═══════════════════════════════════════════════════════════════

-- Timestamps stay UNIX-ms bigints (as in SQLite): the client's optimistic-
-- concurrency guard compares them numerically, and Modified is user-editable.
create table public.entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null check (length(btrim(title)) > 0),
  body_md    text not null check (length(btrim(body_md)) > 0),
  summary    text not null default '',
  label      text not null default 'Uncategorized',
  sublabel   text default null,
  tags       jsonb not null default '[]'::jsonb,
  fields     jsonb not null default '{}'::jsonb,
  urls       jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  -- Native Postgres FTS replacing the FTS5 shadow table: weights mirror the
  -- old column order (title > tags/fields > summary > body).
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')),       'A') ||
    setweight(to_tsvector('english', coalesce(tags::text, '')),  'B') ||
    setweight(to_tsvector('english', coalesce(fields::text, '')),'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')),     'C') ||
    setweight(to_tsvector('english', coalesce(body_md, '')),     'D')
  ) stored
);

create index entries_search_idx     on public.entries using gin (search);
create index entries_user_upd_idx   on public.entries (user_id, updated_at desc);
create index entries_tags_idx       on public.entries using gin (tags jsonb_path_ops);

-- created_at is immutable and rows can never be reassigned to another user
-- (ports the SQLite entries_created_at_immutable trigger).
create or replace function public.forbid_immutable_changes()
returns trigger
language plpgsql
as $$
begin
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is immutable';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable';
  end if;
  return new;
end;
$$;

create trigger entries_immutable
  before update on public.entries
  for each row execute function public.forbid_immutable_changes();

alter table public.entries enable row level security;

-- Owner-only CRUD. Admins have NO policy here: LogBook data blindness.
create policy entries_select on public.entries
  for select using (user_id = auth.uid());
create policy entries_insert on public.entries
  for insert with check (user_id = auth.uid());
create policy entries_update on public.entries
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy entries_delete on public.entries
  for delete using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 3. Prompt Library
-- ═══════════════════════════════════════════════════════════════

create table public.prompts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title          text not null check (length(btrim(title)) > 0),
  category       text not null default 'GENERAL',
  body           text not null check (length(btrim(body)) > 0),
  why_this_works text not null default '',
  tags           jsonb not null default '[]'::jsonb,
  created_at     bigint not null,
  updated_at     bigint not null,
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')),      'A') ||
    setweight(to_tsvector('english', coalesce(tags::text, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')),   'B') ||
    setweight(to_tsvector('english', coalesce(body, '')),       'C')
  ) stored
);

create index prompts_search_idx   on public.prompts using gin (search);
create index prompts_user_idx     on public.prompts (user_id, category, title);
create index prompts_tags_idx     on public.prompts using gin (tags jsonb_path_ops);

create trigger prompts_immutable
  before update on public.prompts
  for each row execute function public.forbid_immutable_changes();

alter table public.prompts enable row level security;

create policy prompts_select on public.prompts
  for select using (user_id = auth.uid());
create policy prompts_insert on public.prompts
  for insert with check (user_id = auth.uid());
create policy prompts_update on public.prompts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy prompts_delete on public.prompts
  for delete using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 4. Edge Function rate limiting
-- ═══════════════════════════════════════════════════════════════

-- Fixed-window counters for custom-rate-limited Edge Functions (admin
-- password resets, account deletion). RLS is enabled with NO policies:
-- only the service role (which bypasses RLS) can touch it.
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 1,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;

-- Atomic increment-and-report used by Edge Functions (service role).
create or replace function public.bump_rate_limit(p_key text, p_window_seconds int)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  w timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, w, 1)
  on conflict (key, window_start) do update set count = rl.count + 1
  returning count into n;
  -- opportunistic cleanup of expired windows for this key
  delete from public.rate_limits
   where key = p_key and window_start < now() - make_interval(secs => p_window_seconds * 2);
  return n;
end;
$$;

revoke all on function public.bump_rate_limit(text, int) from public;
revoke all on function public.bump_rate_limit(text, int) from authenticated, anon;
