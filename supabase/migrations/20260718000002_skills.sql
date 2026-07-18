-- Bento OS — Skills tab (schema v5): a curated, admin-maintained catalog of
-- agent skills (vercel-labs/skills ecosystem), per-user install tracking,
-- and a server-only cache of fetched SKILL.md content.
--
-- Unlike entries/prompts/snippets, the catalog is SHARED, not personal
-- content: authenticated users can read every row, but only admins can
-- write it (data blindness applies to user content, not this curated list).

create table public.skill_catalog (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  description     text not null default '',
  owner           text not null,
  repo            text not null,
  skill_path      text not null,
  category        text not null default 'GENERAL',
  install_command text not null,
  tags            jsonb not null default '[]'::jsonb,
  created_at      bigint not null,
  updated_at      bigint not null,
  unique (owner, repo, skill_path)
);

alter table public.skill_catalog enable row level security;

create policy skill_catalog_select on public.skill_catalog
  for select to authenticated using (true);
create policy skill_catalog_insert on public.skill_catalog
  for insert to authenticated with check (public.is_admin());
create policy skill_catalog_update on public.skill_catalog
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy skill_catalog_delete on public.skill_catalog
  for delete to authenticated using (public.is_admin());

-- Per-user "I've installed this" tracking — owner-only, like entries/prompts.
-- installed_sha records the upstream tree SHA at the moment of marking
-- installed; update_available (computed client-side) compares it against
-- skill_cache.upstream_sha.
create table public.user_skills (
  user_id       uuid not null references auth.users (id) on delete cascade,
  skill_id      uuid not null references public.skill_catalog (id) on delete cascade,
  installed_sha text,
  installed_at  bigint not null,
  primary key (user_id, skill_id)
);

alter table public.user_skills enable row level security;

create policy user_skills_select on public.user_skills
  for select using (user_id = auth.uid());
create policy user_skills_insert on public.user_skills
  for insert with check (user_id = auth.uid());
create policy user_skills_update on public.user_skills
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_skills_delete on public.user_skills
  for delete using (user_id = auth.uid());

-- Server-fetched SKILL.md content, cached to respect GitHub's unauthenticated
-- rate limit (60 req/hr/IP). Read-only from the client; only the
-- skills-proxy Edge Function (service role, bypasses RLS) ever writes it.
create table public.skill_cache (
  skill_id     uuid primary key references public.skill_catalog (id) on delete cascade,
  skill_md     text not null default '',
  upstream_sha text,
  etag         text,
  fetched_at   timestamptz not null default now()
);

alter table public.skill_cache enable row level security;

create policy skill_cache_select on public.skill_cache
  for select to authenticated using (true);
-- No insert/update/delete policies: service role only.

-- Verified catalog seed (12 skills; paths confirmed against live repos —
-- see the implementation plan's "Verified external facts" table).
insert into public.skill_catalog
  (name, description, owner, repo, skill_path, category, install_command, tags, created_at, updated_at)
values
  ('pdf', 'Read, fill, and edit PDF documents, including forms and merged/split pages.',
   'anthropics', 'skills', 'skills/pdf', 'DOCUMENTS',
   'npx skills add anthropics/skills --skill pdf', '["pdf","documents"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('docx', 'Create and edit Word documents with formatting, tables, and images.',
   'anthropics', 'skills', 'skills/docx', 'DOCUMENTS',
   'npx skills add anthropics/skills --skill docx', '["docx","documents"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('pptx', 'Build and edit PowerPoint presentations, slide by slide.',
   'anthropics', 'skills', 'skills/pptx', 'DOCUMENTS',
   'npx skills add anthropics/skills --skill pptx', '["pptx","documents"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('xlsx', 'Read, write, and analyze Excel spreadsheets, including formulas.',
   'anthropics', 'skills', 'skills/xlsx', 'DOCUMENTS',
   'npx skills add anthropics/skills --skill xlsx', '["xlsx","documents"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('skill-creator', 'Scaffold and package new agent skills, including SKILL.md and metadata.',
   'anthropics', 'skills', 'skills/skill-creator', 'META',
   'npx skills add anthropics/skills --skill skill-creator', '["meta","authoring"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('mcp-builder', 'Build Model Context Protocol servers and tools from a spec.',
   'anthropics', 'skills', 'skills/mcp-builder', 'DEV',
   'npx skills add anthropics/skills --skill mcp-builder', '["mcp","dev"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('webapp-testing', 'Drive and verify web apps end-to-end with a real browser.',
   'anthropics', 'skills', 'skills/webapp-testing', 'DEV',
   'npx skills add anthropics/skills --skill webapp-testing', '["testing","dev"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('frontend-design', 'Aesthetic direction and typography for building distinctive frontend UI.',
   'anthropics', 'skills', 'skills/frontend-design', 'DESIGN',
   'npx skills add anthropics/skills --skill frontend-design', '["design","frontend"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('react-best-practices', 'Idiomatic React patterns: hooks, composition, and performance.',
   'vercel-labs', 'agent-skills', 'skills/react-best-practices', 'DEV',
   'npx skills add vercel-labs/agent-skills --skill react-best-practices', '["react","dev"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('web-design-guidelines', 'Practical web design guidelines for layout, spacing, and color.',
   'vercel-labs', 'agent-skills', 'skills/web-design-guidelines', 'DESIGN',
   'npx skills add vercel-labs/agent-skills --skill web-design-guidelines', '["design","web"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('test-driven-development', 'Write the failing test first, then the minimal code to pass it.',
   'obra', 'superpowers', 'skills/test-driven-development', 'WORKFLOW',
   'npx skills add obra/superpowers --skill test-driven-development', '["tdd","workflow"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),

  ('systematic-debugging', 'A repeatable method for isolating and fixing hard bugs.',
   'obra', 'superpowers', 'skills/systematic-debugging', 'WORKFLOW',
   'npx skills add obra/superpowers --skill systematic-debugging', '["debugging","workflow"]'::jsonb,
   (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint);
