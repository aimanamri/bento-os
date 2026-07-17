-- Bento OS — Code Snippets tab (schema v4).
-- Reusable terminal/CLI command templates (curl, bash/powershell/cmd, maven,
-- git) sharing the Prompt Library's {{Variable}} fill-in engine.
--
-- Mirrors public.prompts structurally, with two renames:
--   * `category`       doubles as the Language/Tool label and grouping key
--   * `notes`          replaces `why_this_works` on the card's flip side
--
-- Everything else follows the patterns established in the init migration:
-- UUID PK, user_id defaulting to auth.uid() with ON DELETE CASCADE (which is
-- what makes the GDPR delete-account Edge Function cascade here for free),
-- a generated tsvector for FTS, and owner-only RLS.

create table public.snippets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null check (length(btrim(title)) > 0),
  category   text not null default 'GENERAL',
  body       text not null check (length(btrim(body)) > 0),
  notes      text not null default '',
  tags       jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  -- Weights mirror prompts_search: title > tags/category > body. `notes` is
  -- deliberately unindexed, matching prompts (which omits why_this_works) —
  -- search stays scoped to what identifies the command, not its prose.
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')),      'A') ||
    setweight(to_tsvector('english', coalesce(tags::text, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')),   'B') ||
    setweight(to_tsvector('english', coalesce(body, '')),       'C')
  ) stored
);

create index snippets_search_idx on public.snippets using gin (search);
create index snippets_user_idx   on public.snippets (user_id, category, title);
create index snippets_tags_idx   on public.snippets using gin (tags jsonb_path_ops);

-- created_at immutable + rows never reassignable to another user. Reuses the
-- shared function defined alongside the entries table in the init migration.
create trigger snippets_immutable
  before update on public.snippets
  for each row execute function public.forbid_immutable_changes();

alter table public.snippets enable row level security;

-- Owner-only CRUD. Admins have NO policy here, matching entries/prompts:
-- user content stays private even from admins (data blindness).
create policy snippets_select on public.snippets
  for select using (user_id = auth.uid());
create policy snippets_insert on public.snippets
  for insert with check (user_id = auth.uid());
create policy snippets_update on public.snippets
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy snippets_delete on public.snippets
  for delete using (user_id = auth.uid());
