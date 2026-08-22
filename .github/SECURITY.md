# Security Policy

Bento OS is a personal knowledge base app, run either self-hosted (Docker +
Supabase, or the `dev-local-auth` branch's SQLite/Express build) or over a
private Tailscale network. It's maintained by one person in their spare
time — please be patient with response times.

For the full technical security architecture (threat model, render-pipeline
internals, every control listed below in detail) see
[docs/SECURITY.md](../docs/SECURITY.md). This page is only about reporting
a vulnerability, plus a summary of that architecture so a reporter can
quickly tell whether something is a real gap or already-mitigated.

## Architecture at a Glance

- **`main`** talks to Postgres only through `supabase-js`, with
  **Row-Level Security** as the real trust boundary (`entries`/`prompts`/
  `snippets` are owner-only — admins have no read policy on them at all).
  `server/index.js` is a static file host; there is no server-side `/api`.
- **`dev-local-auth`** is the legacy SQLite/Express variant: parameterized
  `better-sqlite3` queries, server-side input validation.
- **XSS defense** is a single choke point: all markdown/Mermaid/KaTeX
  output passes through one `DOMPurify.sanitize()` call before it ever
  touches the DOM, backed by a CSP with no `unsafe-inline` for scripts.
- **Privileged actions** (creating/deleting a user, resetting a password)
  run as Supabase Edge Functions that authenticate the caller and check
  their role server-side — never trusted from the client.
- **Self-hosted deployments** bind to `127.0.0.1` by default; reaching
  them over a LAN or the internet is an explicit opt-in
  (`BENTO_BIND`/Tailscale), not the default.

## Supported Versions

There are no numbered releases yet (`0.x`, pre-1.0). Only the latest commit
on the default branch (`main`, Supabase backend) and the latest commit on
[`dev-local-auth`](../../tree/dev-local-auth) (SQLite/Express backend)
receive security fixes. If you're running an older checkout, please update
before reporting — the issue may already be fixed.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately using one of:

1. **GitHub Private Vulnerability Reporting** — go to the
   [Security tab](../../security/advisories/new) of this repository and
   click "Report a vulnerability". This is the preferred channel.
2. **Email** — [aaai.mang000@gmail.com](mailto:aaai.mang000@gmail.com). Please
   include "SECURITY" in the subject line.

Include as much detail as you can:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof-of-concept.
- The commit/branch/version affected.
- Whether it requires a specific configuration (e.g. Supabase vs. local
  SQLite variant, self-hosted vs. Tailscale-exposed).

### What to expect

- **Acknowledgement** within 5 business days.
- I'll investigate and let you know if it's confirmed, and give a rough
  timeline for a fix.
- Once a fix is released, I'll credit you in the release notes / commit
  message, unless you'd prefer to stay anonymous.
- Please allow a reasonable period for a fix to ship before any public
  disclosure (coordinated disclosure).

## Scope

**In scope:** vulnerabilities in Bento OS's own code — the render/sanitize
pipeline, authentication and RBAC logic, API/database access, Docker
images and setup scripts in this repository.

**Out of scope:**

- Vulnerabilities in third-party dependencies (Supabase, Tailscale,
  browser, OS) — please report those upstream. If a dependency issue is
  exploitable specifically because of how Bento OS uses it, that *is* in
  scope here.
- The security of a user's own self-hosted deployment (weak passwords,
  exposed ports, unmanaged Tailscale ACLs, outdated Docker images they
  haven't pulled). See [docs/SECURITY.md](../docs/SECURITY.md) for
  deployment hardening guidance.
- Social engineering, physical access, or denial-of-service against a
  single self-hosted, single/few-user instance.

## Disclosure

This project does not currently run a bug bounty program.
