-- Bento OS — seed every new account with a Welcome LogBook entry + one
-- example prompt (docs/UX-SPEC.md §7). Closes the gap noted in
-- docs/IMPLEMENTATION-SUPABASE.md §11.4: only the bootstrap admin ever got
-- onboarding content before this migration.

-- SECURITY DEFINER so it can insert into entries/prompts on behalf of a
-- brand-new user whose session (if any) wouldn't yet satisfy RLS anyway —
-- this always runs from handle_new_user's trigger context, never a client.
-- Idempotent per table: safe to call more than once for the same user.
-- Tagged $fn$ (not bare $$): the seeded markdown below contains literal
-- "$$" (KaTeX display-math delimiters), which would otherwise close the
-- function body's own quoting early.
create or replace function public.seed_user_content(uid uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not exists (select 1 from public.entries where user_id = uid) then
    insert into public.entries
      (user_id, title, body_md, summary, label, tags, fields, urls, created_at, updated_at)
    values (
      uid,
      'Welcome to Bento OS',
      $md$# Welcome to Bento OS

Bento OS is your personal knowledge base: LogBook entries, reusable Prompt
Library templates, and Code Snippets, all in one bento-glass window. This
entry is a working demo of everything a LogBook entry can hold — use the
Reading/Editor toggle next to the title to see this file's raw Markdown.

## What you can do here

- [x] Search and filter entries from the sidebar
- [x] Write in Markdown with a live preview
- [ ] Add your own tags, fields and URLs
- [ ] Visit the Prompt Library and Code Snippets tabs next

## Code

Fenced code blocks render in a readable monospace:

```bash
npx skills add anthropics/skills --skill pdf
```

## Math (KaTeX)

Inline math sits next to text, like the quadratic formula $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$.

Block math gets its own line:

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

## Diagrams (Mermaid)

```mermaid
flowchart LR
    A[Write a note] --> B{Need a template?}
    B -- yes --> C[Prompt Library]
    B -- no --> D[Just write]
    C --> E[Copy & fill variables]
    D --> F[Save entry]
    E --> F
```

## Callouts

> [!NOTE]
> Everything on this page was seeded automatically for your new account —
> edit or delete it any time.

> [!TIP]
> Toggle Reading ↔ Editor mode with the icon beside the title to see this
> entry's raw Markdown source.

> [!WARNING]
> This entry lives only in your account. Deleting your account (account menu
> → Delete my account) removes it permanently — there is no undo.
$md$,
      'A guided tour of headings, task lists, code, math, diagrams and alert blocks — the same content every new Bento OS account starts with.',
      'Welcome',
      '["welcome","demo"]'::jsonb,
      '{"os_platform":"macOS","is_valid":"true"}'::jsonb,
      '["https://github.com/vercel-labs/skills"]'::jsonb,
      now_ms, now_ms
    );
  end if;

  if not exists (select 1 from public.prompts where user_id = uid) then
    insert into public.prompts
      (user_id, title, category, body, why_this_works, tags, created_at, updated_at)
    values (
      uid,
      'Explain a concept simply',
      'WRITING',
      $body$Explain {{Concept}} to a {{Audience}} using one simple real-world analogy, then walk through a single worked example step by step.$body$,
      $why$Naming the audience forces the explanation to calibrate vocabulary and depth, and asking for an analogy before the worked example gives the reader a mental hook before the details arrive.$why$,
      '["writing","learning"]'::jsonb,
      now_ms, now_ms
    );
  end if;
end;
$fn$;

revoke all on function public.seed_user_content(uuid) from public, authenticated, anon;

-- Extend the signup trigger: seed welcome content right after the
-- profile/role rows, guarded so a seeding failure can never block signup.
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

  begin
    perform public.seed_user_content(new.id);
  exception when others then
    raise warning 'seed_user_content failed for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;
-- Trigger declaration (on_auth_user_created) is unchanged — it already
-- points at this function by name.
