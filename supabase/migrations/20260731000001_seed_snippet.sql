-- Bento OS — extend seed_user_content() to also seed one example Code
-- Snippet. 20260718000001_new_user_seeds.sql covered the LogBook entry and
-- Prompt Library but shipped before the snippets table (20260717000001)
-- existed*, so new accounts only ever got two of the three tabs' worth of
-- onboarding content. (*chronologically the snippets migration predates it,
-- but the seed function was written without it — see docs/IMPLEMENTATION-SUPABASE.md
-- §11.4.)
--
-- create or replace requires the full function body, so this reproduces the
-- entries/prompts blocks unchanged and adds a third block for snippets.
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

  if not exists (select 1 from public.snippets where user_id = uid) then
    insert into public.snippets
      (user_id, title, category, body, notes, tags, created_at, updated_at)
    values (
      uid,
      'Install a Claude skill',
      'BASH',
      $snip$npx skills add {{Repo (owner/name)}} --skill {{Skill Name}}$snip$,
      $notes$Pinning the repo and skill name as variables means you fill in one line instead of retyping the whole `npx` invocation for every skill you try — the same one demoed in your Welcome LogBook entry.$notes$,
      '["cli","skills"]'::jsonb,
      now_ms, now_ms
    );
  end if;
end;
$fn$;

revoke all on function public.seed_user_content(uuid) from public, authenticated, anon;
