// English — the reference catalogue.
//
// Every phrase here was lifted verbatim from the markup and the modules it
// replaced, so the English build reads exactly as it always has. That makes
// this file the diffable baseline: anything a translation gets wrong shows up
// as a difference from a line here, not as a regression in the product.
//
// Values are strings, or functions of a vars object where a phrase has to bend
// around a number or a name. Plurals live inside those functions, which is how
// English keeps its -s without pushing a plural rule onto languages that have
// none.

export default {
  /* ── app shell ─────────────────────────────────────────────── */
  'app.title': 'Bento OS',

  'nav.tools': 'Tools',
  'nav.tab.logbook': 'Docs LogBook',
  'nav.tab.logbook.short': 'LogBook',
  'nav.tab.prompts': 'Prompt Library',
  'nav.tab.prompts.short': 'Prompts',
  'nav.tab.snippets': 'Code Snippets',
  'nav.tab.snippets.short': 'Snippets',
  'nav.minimize': 'Minimize current tool to dock',
  'nav.focus': 'Toggle focus mode',
  'nav.fullscreen': 'Toggle fullscreen',
  'nav.unsaved': 'Unsaved changes',
  'nav.offline': 'offline',
  'nav.hostUnreachable': 'Host unreachable',
  'nav.accountMenu': 'Account menu',
  'nav.account': 'Account',
  'nav.dock': 'Minimized tools',

  'menu.admin': 'User management',
  'menu.changepw': 'Change password',
  'menu.install': 'Install Bento OS…',
  'menu.delete': 'Delete my account…',
  'menu.signout': 'Sign out',

  'theme.toggle': 'Toggle light or dark theme',
  'lang.toggle': 'Change display language',
  'lang.label': 'Language',

  'main.focusOn': 'Focus mode on',
  'main.focusOff': 'Focus mode off',
  'main.noFullscreen': 'Fullscreen is not supported here',
  'main.updated': 'Bento OS was updated — reloading',
  'main.restore': ({ name }) => `Restore ${name}`,
  'main.minimized': ({ name }) => `${name} minimized to dock`,
  'main.restored': ({ name }) => `${name} restored`,

  'pwa.installed': 'Bento OS installed — it now opens in its own window',
  'pwa.updateReady': 'Update ready — it applies next time you open Bento OS',

  'ui.dismissNotice': 'Dismiss notice',

  'clip.title': 'Copy manually',
  'clip.body':
    'Clipboard access is unavailable here (it needs HTTPS — e.g. the tailscale serve URL). Select and copy the text below:',

  /* ── shared vocabulary ─────────────────────────────────────── */
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.save': 'Save',
  'common.gotIt': 'Got it',
  'common.copy': 'Copy',
  'common.copied': '✓ Copied',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.done': 'Done',
  'common.all': 'All',
  'common.clearFilters': 'Clear filters',
  'common.commaSeparated': '(comma-separated)',
  'common.markdownSupported': '· Markdown supported',
  'common.reloadTheirs': 'Reload theirs',
  'common.overwriteTheirs': 'Overwrite theirs',
  'common.filterByTag': 'Filter by tag',
  'common.willBeDeleted': ({ title }) => `“${title}” will be permanently deleted.`,
  'common.noMatchQuery': ({ q }) => `Nothing matches “${q}”.`,
  'common.noMatchTags': 'Nothing matches the selected tags.',
  'common.placeholderHint': 'Click a highlighted placeholder to fill it in.',
  'common.varsHintPre': 'Double-brace variables like ',
  'common.varsHintPost': ' become directly editable placeholders on the card.',
  'common.savedElsewhere': 'Saved on another device',

  'time.now': 'now',
  'time.minutes': ({ n }) => `${n}m ago`,
  'time.hours': ({ n }) => `${n}h ago`,
  'time.days': ({ n }) => `${n}d ago`,

  /* ── Docs LogBook ──────────────────────────────────────────── */
  'lb.new': 'New Entry',
  'lb.import': 'Import',
  'lb.importTitle': 'Import as Markdown file',
  'lb.searchLabel': 'Search entries',
  'lb.searchPlaceholder': 'Search titles, tags, notes…',
  'lb.groupBy': 'Group entries by',
  'lb.group.flat': 'Flat',
  'lb.group.label': 'Label',
  'lb.group.year': 'Year',
  'lb.savedEntries': 'Saved entries',
  'lb.guide': 'Markdown Guide',
  'lb.guideClose': 'Close guide',
  'lb.openList': 'Open entries list',
  'lb.hideSidebar': 'Hide sidebar',
  'lb.showSidebar': 'Show sidebar',
  'lb.titleLabel': 'Entry title',
  'lb.titlePlaceholder': 'Untitled entry',
  'lb.edited': 'Edited',
  'lb.hideMeta': 'Hide metadata',
  'lb.showMeta': 'Show metadata',
  'lb.readMode.title': 'Reading mode — click to edit',
  'lb.readMode.aria': 'Reading mode (switch to editor)',
  'lb.editMode.title': 'Editor mode — click to read',
  'lb.editMode.aria': 'Editor mode (switch to reading)',
  'lb.save': 'Save Entry',
  'lb.saving': 'Saving…',
  'lb.savedFlash': '✓ Saved',
  'lb.close': 'Close entry',
  'lb.summary': 'Summary / Problem Statement',
  'lb.summaryLabel': 'Summary or problem statement',
  'lb.summaryPlaceholder': 'What problem does this entry solve?',
  'lb.body': 'Body',
  'lb.bodyHint': '(Content: knowledges, solutions, troubleshooting, workarounds)',
  'lb.formatting': 'Formatting',
  'lb.bulb': 'Syntax reference: LaTeX and Mermaid boilerplate',
  'lb.bulbMenu': 'Insert syntax boilerplate',
  'lb.viewToggle': 'Editor or preview',
  'lb.write': 'Write',
  'lb.preview': 'Preview',
  'lb.editorLabel': 'Markdown details and solution',
  'lb.editorPlaceholder':
    'Write your notes in Markdown…\n\n$inline math$, $$block math$$, and ```mermaid diagrams are supported.',
  'lb.resize': 'Resize editor and preview',
  'lb.previewLabel': 'Rendered preview',
  'lb.empty': 'No entry open — pick one from the list, or start a new one.',
  'lb.previewFailed': 'Preview failed to render.',
  'lb.delete': 'Delete entry',
  'lb.drawer': 'Entries',

  'lb.noMatch': ({ q }) => `No entries match “${q}”.`,
  'lb.noEntries': 'No entries yet — create your first one.',
  'lb.clearSearch': 'Clear search',
  'lb.noTagMatch': ({ n }) => `No entries match the selected tag${n > 1 ? 's' : ''}.`,
  'lb.clearTagFilter': 'Clear tag filter',

  'lb.unsaved.title': 'Unsaved changes',
  'lb.unsaved.body': 'This entry has edits that haven’t been saved.',
  'lb.unsaved.discard': 'Discard changes',
  'lb.needsBoth.title': 'Entry needs a title and details',
  'lb.needsTitle.body': 'Give the entry a title before saving.',
  'lb.needsBody.body': 'Write some details before saving.',
  'lb.conflict.body': ({ when }) =>
    `This entry changed on the server at ${when}. Your version and theirs now differ.`,
  'lb.conflict.unknownTime': 'an unknown time',
  'lb.conflict.copyload': 'Copy mine & load theirs',
  'lb.conflict.copied': 'Your version copied to clipboard',
  'lb.gone.title': 'Entry was deleted elsewhere',
  'lb.gone.body': 'This entry no longer exists on the server.',
  'lb.gone.saveNew': 'Save as new entry',
  'lb.gone.discard': 'Discard',
  'lb.delete.title': 'Delete this entry?',
  'lb.draft.title': 'Restore unsaved draft?',
  'lb.draft.bodyNewer': ({ draft, server }) =>
    `A draft from ${draft} was found, but this entry was saved more recently (${server}) — possibly on another device.`,
  'lb.draft.body': ({ when, isNew }) =>
    `An unsaved draft from ${when} was found${isNew ? ' for a new entry' : ''}.`,
  'lb.draft.keepServer': 'Keep newer version',
  'lb.draft.restoreAnyway': 'Restore draft anyway',
  'lb.draft.restore': 'Restore draft',
  'lb.draft.discard': 'Discard draft',
  'lb.banner.newer': 'This entry was updated on another device.',
  'lb.banner.review': 'Review',
  'lb.banner.keepMine': 'Keep mine',
  'lb.import.tooLarge.title': 'File too large',
  'lb.import.tooLarge.body': 'Markdown imports are limited to 2 MB.',
  'lb.import.failed.title': 'Import failed',
  'lb.toast.imported': ({ title }) => `Imported “${title}”`,
  'lb.toast.gone': 'That entry no longer exists',
  'lb.toast.offlineDraft': "Couldn't reach Bento host — your draft is safe locally",
  'lb.toast.saved': 'Entry saved',
  'lb.toast.deleted': 'Entry deleted',
  'lb.toast.refreshed': 'Entry refreshed from another device',
  'lb.toast.backupPaused': 'Auto-backup paused — note too large for browser storage',
  'lb.toast.noStorage': 'Browser storage unavailable — autosave is off this session',
  'lb.toast.hostDown': "Couldn't reach the Bento host — check that the server is running",

  /* ── metadata panel ────────────────────────────────────────── */
  'meta.title': 'Metadata',
  'meta.close': 'Close metadata',
  'meta.label': 'Label',
  'meta.labelPlaceholder': 'Uncategorized',
  'meta.sublabel': 'Sub-label',
  'meta.sublabel.optional': 'optional',
  'meta.sublabel.needsLabel': 'needs a label first',
  'meta.tags': 'Tags',
  'meta.tagsPlaceholder': 'linux, docker, fix',
  'meta.fields': 'Fields',
  'meta.fieldNameLabel': 'New field name',
  'meta.fieldValueLabel': 'New field value',
  'meta.fieldNamePlaceholder': 'field name',
  'meta.fieldValuePlaceholder': 'field value',
  'meta.addField': 'Add field',
  'meta.add': 'add',
  'meta.noFields': 'No fields yet — add one below (e.g. os_platform, is_valid).',
  'meta.fieldValueFor': ({ name }) => `Value for field ${name}`,
  'meta.removeField': ({ name }) => `Remove field ${name}`,
  'meta.remove': ({ name }) => `Remove ${name}`,
  'meta.created': 'Created',
  'meta.readonly': '(read-only)',
  'meta.createdEmpty': '— (set on first save)',
  'meta.createdUnix': ({ ms }) => `UNIX ms: ${ms}`,
  'meta.modified': 'Modified',
  'meta.urls': 'URL list',
  'meta.urlsPlaceholder': 'https://…, https://…',
  'meta.urlCount': ({ n }) => `${n} link${n === 1 ? '' : 's'}`,
  'meta.urlInvalid': ({ url }) => `${url}\nNot a valid http(s) URL — kept as a note`,

  /* ── Prompt Library ────────────────────────────────────────── */
  'pr.searchLabel': 'Search prompts',
  'pr.searchPlaceholder': 'Search prompts…',
  'pr.new': 'New Prompt',
  'pr.empty': 'No prompts yet. Save your first reusable template.',
  'pr.edit': 'Edit prompt',
  'pr.delete': 'Delete prompt',
  'pr.why': 'Why this works',
  'pr.dlg.new': 'New Prompt',
  'pr.dlg.edit': 'Edit Prompt',
  'pr.dlg.close': 'Close prompt editor',
  'pr.f.title': 'Title',
  'pr.f.category': 'Category',
  'pr.f.categoryPlaceholder': 'GENERAL',
  'pr.f.tags': 'Tags (comma-separated)',
  'pr.f.tagsPlaceholder': 'writing, code',
  'pr.f.body': 'Prompt',
  'pr.f.bodyPlaceholder': 'Use {{Variable Name}} for fill-in placeholders.',
  'pr.f.varSample': '{{Topic}}',
  'pr.f.whyPlaceholder': "The reasoning behind this prompt's structure…",
  'pr.f.save': 'Save Prompt',
  'pr.err.required': 'A prompt needs both a title and prompt text.',
  'pr.conflict.body': 'This prompt changed on the server since you opened it.',
  'pr.delete.title': 'Delete this prompt?',
  'pr.toast.saved': 'Prompt saved',
  'pr.toast.updated': 'Prompt updated',
  'pr.toast.deleted': 'Prompt deleted',
  'pr.toast.loadFailed': "Couldn't load prompts",

  /* ── Code Snippets ─────────────────────────────────────────── */
  'sn.searchLabel': 'Search snippets',
  'sn.searchPlaceholder': 'Search commands, languages, tags…',
  'sn.new': 'New Snippet',
  'sn.empty': 'No snippets yet. Save your first reusable command.',
  'sn.edit': 'Edit snippet',
  'sn.delete': 'Delete snippet',
  'sn.notes': 'Notes',
  'sn.dlg.new': 'New Snippet',
  'sn.dlg.edit': 'Edit Snippet',
  'sn.dlg.close': 'Close snippet editor',
  'sn.f.title': 'Title',
  'sn.f.category': 'Language / Tool',
  'sn.f.categoryPlaceholder': 'BASH',
  'sn.f.tags': 'Tags (comma-separated)',
  'sn.f.tagsPlaceholder': 'ssh, remote',
  'sn.f.body': 'Command',
  'sn.f.bodyPlaceholder': 'curl -v {{URL Link}}',
  'sn.f.varSample': '{{File Name}}',
  'sn.f.notes': 'Notes',
  'sn.f.notesPlaceholder': 'Flags, platform differences, gotchas…',
  'sn.f.save': 'Save Snippet',
  'sn.err.required': 'A snippet needs both a title and command text.',
  'sn.conflict.body': 'This snippet changed on the server since you opened it.',
  'sn.delete.title': 'Delete this snippet?',
  'sn.toast.saved': 'Snippet saved',
  'sn.toast.updated': 'Snippet updated',
  'sn.toast.deleted': 'Snippet deleted',
  'sn.toast.loadFailed': "Couldn't load snippets",

  /* ── lock screen ───────────────────────────────────────────── */
  'auth.signInSub': 'Sign in to your workspace',
  'auth.oneMoreStep': 'One more step',
  'auth.welcomeBack': ({ name }) => `Welcome back, ${name}`,
  'auth.signedInAs': ({ name }) => `Signed in as ${name}`,
  'auth.userId': 'User ID',
  'auth.password': 'Password',
  'auth.signIn': 'Sign in',
  'auth.createAccountLink': 'Create an account',
  'auth.createAccountSubmit': 'Create account',
  'auth.haveAccount': 'I already have an account',
  'auth.cpIntro':
    'Choose a new password before continuing. Default or reset passwords must be replaced before the dashboard opens.',
  'auth.newPassword': 'New password',
  'auth.confirmPassword': 'Confirm new password',
  'auth.setPassword': 'Set new password',
  'auth.backToApp': 'Back to the app',
  'auth.newHere': 'New here?',
  'auth.seeWhat': 'See what Bento OS does',
  'auth.dock.logbook': 'About the Docs LogBook',
  'auth.dock.prompts': 'About the Prompt Library',
  'auth.dock.snippets': 'About Code Snippets',
  'auth.err.badUsername': 'User ID: 2–32 letters, digits, dot, dash or underscore',
  'auth.err.shortPassword': ({ n }) => `Password needs at least ${n} characters`,
  'auth.err.defaultReuse': 'The default password cannot be reused',
  'auth.err.mismatch': 'Passwords do not match',
  'auth.err.wrongCreds': 'Wrong User ID or password',
  'auth.err.taken': 'That User ID is taken',
  'auth.err.rateLimit': 'Too many attempts — wait a moment and try again',
  'auth.err.failed': 'Sign-in failed',
  'auth.toast.pwUpdated': 'Password updated',
  'auth.delete.title': 'Delete your account?',
  'auth.delete.body':
    'This permanently erases your account, every LogBook entry and every prompt. There is no undo and nothing is retained (GDPR/PDPA hard delete).',
  'auth.delete.confirm': 'Delete everything',
  'auth.delete.failed': 'Account deletion failed — try again later',
  'auth.delete.done': 'Account deleted',

  /* ── user management ───────────────────────────────────────── */
  'admin.title': 'User management',
  'admin.close': 'Close user management',
  'admin.filterLabel': 'Filter users',
  'admin.filterPlaceholder': 'Filter by User ID…',
  'admin.newUser': '+ New user',
  'admin.newUserLabel': 'New User ID',
  'admin.newUserPlaceholder': 'New User ID',
  'admin.create': 'Create',
  'admin.footer': 'New accounts start with the default password and must change it at first sign-in.',
  'admin.loading': 'Loading…',
  'admin.loadFailed': 'Could not load users.',
  'admin.count': ({ n }) => `${n} ${n === 1 ? 'person' : 'people'}`,
  'admin.noUsers': 'No users yet.',
  'admin.role.global_admin': 'global admin',
  'admin.role.admin': 'admin',
  'admin.role.user': 'user',
  'admin.section.global_admin': 'Global admin',
  'admin.section.admin': 'Admins',
  'admin.section.user': 'Users',
  'admin.you': 'you',
  'admin.youTitle': 'You cannot change your own role or delete your own account here',
  'admin.resetPending': 'reset pending',
  'admin.resetPendingTitle': 'Must change password at next sign-in',
  'admin.accountCreated': 'Account created',
  'admin.action.reset.label': 'Reset password',
  'admin.action.reset.button': 'Reset',
  'admin.action.reset.desc':
    'Sets their password back to the default and forces a change at their next sign-in.',
  'admin.action.promote.label': 'Make admin',
  'admin.action.promote.button': 'Promote',
  'admin.action.promote.desc':
    "Lets them create users and reset passwords. They still cannot read anyone else's notes.",
  'admin.action.demote.label': 'Remove admin',
  'admin.action.demote.button': 'Demote',
  'admin.action.demote.desc':
    'Returns them to a normal user. Their own entries and prompts are untouched.',
  'admin.action.delete.label': 'Delete account',
  'admin.action.delete.button': 'Delete…',
  'admin.action.delete.desc':
    'Erases the account and every entry, prompt and snippet they own. This cannot be undone.',
  'admin.promoteFailed': 'Promotion failed',
  'admin.demoteFailed': 'Demotion failed',
  'admin.nowAdmin': ({ name }) => `${name} is now an admin`,
  'admin.nowUser': ({ name }) => `${name} is a normal user again`,
  'admin.reset.title': ({ name }) => `Reset ${name}'s password?`,
  'admin.reset.body': ({ pw }) =>
    `Their password returns to the default ("${pw}") and they must choose a new one at next login.`,
  'admin.reset.confirm': 'Reset password',
  'admin.reset.failed': 'Reset failed — you may be rate limited',
  'admin.reset.done': ({ name }) => `${name}'s password was reset to the default`,
  'admin.delete.title': ({ name }) => `Delete ${name}?`,
  'admin.delete.body':
    'This permanently erases their account and every LogBook entry, prompt and snippet they own. There is no undo.',
  'admin.delete.confirm': 'Delete everything',
  'admin.delete.failed': 'Deletion failed — you may be rate limited',
  'admin.delete.done': ({ name }) => `${name} was deleted`,
  'admin.create.failed': 'Account creation failed',
  'admin.create.done': ({ name, pw }) => `${name} created — default password is "${pw}"`,

  /* ── pre-auth tour ─────────────────────────────────────────── */
  'tour.title': 'What Bento OS does',
  'tour.footer': 'Everything you save belongs to your account alone — administrators included.',
  'tour.mini.search': 'search',
  'tour.demoCap.blanks': 'Try it — type into the highlighted blanks',

  'tour.lb.intro':
    "Long-form notes in plain markdown — guides, write-ups, and anything you'll want to find again months from now.",
  'tour.lb.h1': 'Read like a page, edit when you need to',
  'tour.lb.p1':
    'Notes open as clean rendered prose at a comfortable reading width. One toggle switches to the side-by-side editor.',
  'tour.lb.demoCap': 'Try it — edit the left side',
  'tour.lb.youWrite': 'You write',
  'tour.lb.mdLabel': 'Markdown to preview',
  'tour.lb.bentoShows': 'Bento shows',
  'tour.lb.pill1': 'guide',
  'tour.lb.pill2': 'setup',
  'tour.lb.h2': 'Find it again in one search',
  'tour.lb.p2':
    'Search covers the title, tags, your own metadata fields, the summary and the body at once. Group by label or year, or narrow down with tag pills.',
  'tour.lb.foot':
    'Drafts autosave every 10 seconds while you type, so a crash or a stray refresh offers to put your work back.',

  'tour.pr.intro': 'The prompts you keep rewriting, saved once and grouped by category.',
  'tour.pr.pill1': 'writing',
  'tour.pr.pill2': 'code',
  'tour.pr.h1': 'A library, not a scratch file',
  'tour.pr.p1':
    'Every prompt sits in a category with its own tags, so you can search the whole library or filter it down to one kind of work.',
  'tour.pr.blanksNote': 'Blanks you leave empty stay as placeholders.',
  'tour.pr.h2': 'Copy the finished text, not the template',
  'tour.pr.p2':
    'One click puts the composed prompt on your clipboard with the blanks filled in — nothing left to tidy up by hand.',

  'tour.sn.intro': "Commands and code you'd rather not look up twice.",
  'tour.sn.h1': 'Grouped by language, coloured automatically',
  'tour.sn.p1':
    'Whatever language or tool you type becomes its own group with a distinct accent — no palette to pick and nothing to configure.',
  'tour.sn.blanksNote': 'The same blanks as the Prompt Library.',
  'tour.sn.flip': 'flip ↻',
  'tour.sn.h2': 'Keep the why on the back',
  'tour.sn.p2':
    "Flip a card over to store notes with the snippet — what it's for, and the part that bites you at 2am.",

  // Demo content. Deliberately generic: the point is the mechanism, not the
  // subject — and it is written per language rather than translated word for
  // word, so the live preview reads like something a local would have typed.
  'tour.sample.markdown': `## Anything worth finding later

Write in **plain markdown** and it renders as you type.

- the steps that actually worked
- a link you'll want again

\\\`one line of code\\\`
`,
  'tour.sample.prompt': 'Explain {{topic}} to a {{audience}} in {{count}} sentences.',
  'tour.sample.snippet': 'git checkout -b {{branch-name}}',

  /* ── editor ribbon ─────────────────────────────────────────── */
  'ribbon.h1': 'Heading 1',
  'ribbon.h2': 'Heading 2',
  'ribbon.h3': 'Heading 3',
  'ribbon.bold': 'Bold',
  'ribbon.italic': 'Italic',
  'ribbon.strike': 'Strikethrough',
  'ribbon.sup': 'Superscript',
  'ribbon.sub': 'Subscript',
  'ribbon.code': 'Inline code',
  'ribbon.link': 'Link',
  'ribbon.ul': 'Bulleted list',
  'ribbon.ol': 'Numbered list',
  'ribbon.checkbox': 'Checkbox item',
  'ribbon.table': 'Insert 3×4 table',
  'ribbon.alert.note': 'Note alert block',
  'ribbon.alert.tip': 'Tip alert block',
  'ribbon.alert.important': 'Important alert block',
  'ribbon.alert.warning': 'Warning alert block',
  'ribbon.alert.caution': 'Caution alert block',

  // Text the ribbon types into the note itself, not chrome around it — so it
  // follows the display language the way the user's own writing would.
  'ribbon.ph.text': 'text',
  'ribbon.ph.bold': 'bold',
  'ribbon.ph.italic': 'italic',
  'ribbon.ph.code': 'code',
  'ribbon.ph.linkText': 'link text',
  'ribbon.ph.task': 'task',
  'ribbon.table.col': ({ n }) => `Column ${n}`,
  'ribbon.alertBody.note': 'Useful information',
  'ribbon.alertBody.tip': 'Helpful advice',
  'ribbon.alertBody.important': 'Key information',
  'ribbon.alertBody.warning': 'Urgent information',
  'ribbon.alertBody.caution': 'Risks or negative outcomes',
  'ribbon.bulb.inlineLatex': 'Inline LaTeX',
  'ribbon.bulb.blockLatex': 'Block LaTeX',
  'ribbon.bulb.mermaid': 'Mermaid flowchart',
  'ribbon.mermaid.start': 'Start',
  'ribbon.mermaid.decision': 'Decision',
  'ribbon.mermaid.done': 'Done',

  /* ── render pipeline ───────────────────────────────────────── */
  'alert.NOTE': 'Note',
  'alert.TIP': 'Tip',
  'alert.IMPORTANT': 'Important',
  'alert.WARNING': 'Warning',
  'alert.CAUTION': 'Caution',
  'render.copyCode': 'Copy code',
  'render.copyLangCode': ({ lang }) => `Copy ${lang} code`,
  'render.codeCopied': 'Code copied',
  'render.mermaidError': 'Mermaid error',

  'vars.valueFor': ({ name }) => `Value for ${name}`,

  /* ── Markdown guide ──────────────────────────────── */
  'guide.md': `
## Formatting

| Type | Syntax |
| --- | --- |
| Bold | \`**bold**\` |
| Italic | \`*italic*\` |
| Strikethrough | \`~~text~~\` |
| Superscript | \`x<sup>2</sup>\` → x<sup>2</sup> |
| Subscript | \`H<sub>2</sub>O\` → H<sub>2</sub>O |
| Inline code | \`\` \`code\` \`\` |
| Link | \`[label](https://url)\` |
| Jump to a heading | \`[label](#heading-title)\` |
| Heading | \`# H1\` … \`### H3\` |
| Bulleted list | \`- item\` |
| Numbered list | \`1. item\` |
| Checkbox | \`- [ ] task\` / \`- [x] done\` |

## Math (KaTeX)

Inline: \`$E = mc^2$\` → $E = mc^2$

Block:

\`\`\`
$$
\\int_a^b f(x)\\,dx
$$
\`\`\`

Math inside code spans or fences is left as-is. A stray \`$\` can pair with another \`$\` later in the paragraph — escape prices as \`\\$5\`.

## Diagrams (Mermaid)

\`\`\`mermaid
flowchart LR
  A[Start] --> B{Decision}
  B -->|Yes| C[Done]
\`\`\`

A syntax error shows a local warning chip; the rest of the note still renders.

## Alert blocks

Start a quote with a \`[!TYPE]\` marker on its own line:

> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.

## Frontmatter

A \`---\` fence at the very top of a note — closed by \`---\` or \`...\` — renders as a key/value table instead of a rule:

\`\`\`
---
title: Release notes
tags: [ops, deploy]
owner:
  team: platform
  oncall: rotating
---
\`\`\`

Values show exactly as typed — markdown and math inside them stay literal. Nested keys and lists become tables of their own. A \`---\` anywhere else in the note is still a horizontal rule.

## Good to know

- **Links** to \`https://…\` open in a new tab. A link to \`#a-heading-in-this-note\` scrolls you to that heading instead — same tab, same note. Write the heading in lowercase with hyphens for spaces (*Setup Steps* → \`#setup-steps\`).
- **Tags** are comma-separated — a tag can't contain a comma.
- **Labels** left blank file under *Uncategorized*; sub-labels need a label first.
- **Fields** are your own name/value metadata (e.g. \`os_platform: macOS\`, \`is_valid: true\`). Values are plain text and searchable from the sidebar.
- **Created** is set once and can't be changed. **Modified** updates automatically on every save, but you can set it by hand — an edited value is kept instead of bumping to now.
- **Import** takes \`.md\` files up to 2 MB. The first \`# H1\` becomes the title; YAML frontmatter is kept, and renders as a table.
- **Autosave** snapshots your draft every 10 seconds; you'll be offered a restore after a crash or refresh.
- **Install Bento OS** from the account menu to run it in its own window. Installed, it still opens when you're offline — but your entries live on the server, so you'll see the workspace with an *offline* chip and empty lists until you're back online.
- In prompts, \`{{Variable}}\` fill-ins match literally — \`{{A}}{{B}}\` is two variables, \`{{}}\` is plain text.
`,
};
