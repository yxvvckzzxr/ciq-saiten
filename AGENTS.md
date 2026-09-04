# Repository Guidelines

## Project Overview

CIQ is a browser-based competition quiz management system. It manages tournament administration, contestant registration, answer-sheet PDF generation, answer upload, judging, score calculation, conflict resolution, check-in, and post-event score disclosure.

The application is a static frontend backed by Supabase. It is security-sensitive: answer tampering, participant data leakage, and accidental exposure of private images must be treated as serious regressions.

## Architecture

- Frontend: static HTML, vanilla JavaScript, and CSS.
- Backend: Supabase Database, Auth, Storage, Realtime, and Edge Functions.
- Email: Supabase Edge Functions with Brevo by default and SES fallback support.
- Tests: Vitest in `tests/*.test.mjs`.

No Node/Express server exists. Do not introduce one. Business logic currently lives in browser JavaScript and Supabase SQL/Edge Functions.

## Project Structure

- Root HTML files are page entry points: `admin.html`, `index.html`, `entry.html`, `my.html`, `judge.html`, `question.html`, `conflict.html`, `checkin.html`, and related public pages.
- `js/`: page scripts and shared browser modules.
- `css/design_system.css`: global design system.
- `css/pages.css`: page-specific styling.
- `supabase/migrations/`: database schema, RLS, grants, and RPC changes.
- `supabase/functions/`: Edge Functions.
- `docs/`: project knowledge for agents and humans.

## File Ownership Map

- Entry flow: `entry.html`, `js/entry.js`, `supabase/functions/create-entry/`.
- Public list: `entry_list.html`, `js/entry_list.js`, `public_entry_list` migrations.
- Admin: `admin.html`, `js/admin*.js`, `css/pages.css`.
- Answer upload: `js/admin_prep.js`, `js/upload_validation.js`, Storage policies.
- Judging: `judge.html`, `question.html`, `conflict.html`, `js/judge.js`, `js/question.js`, `js/conflict.js`.
- Participant hub (view/2D code/edit/late/cancel/score): `my.html`, `js/my.js`, `supabase/functions/my-entry/`, `supabase/functions/_shared/participant_auth.ts`.
- Score disclosure: my.html の成績セクション + `supabase/functions/disclose-result/`.
- Shared Supabase access: `js/supabase_api.js`.

## Invariants

Never:
- replace Supabase
- introduce React, TypeScript, bundlers, or a build system
- add a Node server
- expose service-role keys, email provider secrets, or private keys in browser code
- weaken CSP, RLS, Storage privacy, or encrypted PII handling
- change database behavior without a migration
- rewrite unrelated files or perform broad refactors inside narrow tasks

Prefer:
- small, reversible changes
- project-local helpers over new abstractions
- explicit validation over implicit assumptions
- documentation updates when behavior or architecture changes

## Before Coding

1. Read the relevant HTML page.
2. Read the matching JS file and shared helpers.
3. Search for reusable utilities before adding new ones.
4. Check `docs/architecture.md`, `docs/security.md`, and `docs/page_structure.md` when the task touches data flow, security, or navigation.
5. Make a scoped plan, then implement.

## During Coding

- Keep current behavior unless the task explicitly changes it.
- Preserve existing page routes and query parameters.
- Avoid changing generated IDs, Storage paths, or database column names casually.
- If a file already has a local helper pattern, extend that pattern.
- If a change touches participant-visible text, check Japanese terminology consistency.

## UI Rules

- Follow `design-system/MASTER.md` (Apple-like white/black/gray, system font stack). No purple, gradients, glow, glassmorphism.
- Reuse `css/design_system.css` and existing utility classes.
- Do not add inline CSS or inline JavaScript.
- Prefer DOM builders and `textContent`; avoid `innerHTML`.
- Use consistent wording: "エントリー" for registration flow, "当日受付" for check-in, and "受付番号" only for contestant numbers.
- Preserve mobile readability and avoid text/background contrast regressions.

## Terminology Rules

- "エントリー": registration and entry-form flow.
- "当日受付": event-day check-in flow.
- "受付番号": contestant number only.
- "成績照会": result disclosure.
- Avoid mixing "成績開示" with "成績照会" unless explicitly requested.

## Security Rules

Treat every browser input and database value as untrusted.

Always:
- validate inputs before parsing or upload
- escape or render user content with `textContent`
- preserve CSP without unsafe inline execution
- preserve RLS and column-grant assumptions
- keep answer image buckets private
- keep participant PII encrypted and hidden from public flows
- use publishable Supabase keys only in browser files

Never:
- log decrypted PII
- return private participant fields to public pages
- use browser-only checks as authorization
- make private buckets public to fix image loading

## Supabase Rules

- Database changes require a new migration in `supabase/migrations/`.
- Edge Function changes should keep shared code in `supabase/functions/_shared/`.
- Public participant actions should go through Edge Functions when identity or project state must be validated.
- Client-side Supabase queries should be centralized in `js/supabase_api.js` where practical.

## Performance Rules

- Avoid repeated full-table reads on hot UI paths.
- Batch Supabase requests where supported.
- Use short-lived signed URL caching only when safe.
- Release large canvases and image buffers after upload or export work.
- Keep realtime subscriptions scoped and clean them up on unload when possible.

## Refactoring Rules

- Do not do broad refactors inside bug fixes.
- Split large files only when the behavior is already stable or the task is explicitly refactoring.
- Preserve public APIs and page globals unless all callers are updated.
- Add tests around extracted pure logic.

## Development Commands

- `python3 -m http.server 8080`: run the static app locally.
- `npm test`: run Vitest tests.
- `find js -name '*.js' -exec node --check {} \;`: syntax-check browser JS.
- `git diff --check`: verify whitespace before commit.

There is no build step.

## Testing Guidelines

Add focused Vitest tests for ranking, upload validation, security helpers, rendering safety, and deterministic pure logic. Name tests `*.test.mjs`. For UI changes, manually inspect affected pages when possible and mention any unverified visual risk.

## Commit & PR Workflow

Prefer issue-scoped work. Keep commits small with imperative summaries such as `Validate answer PDF uploads` or `Tighten style CSP`. Do not commit `.DS_Store`. PRs should include summary, affected pages, verification commands, risks, and screenshots for visible UI changes.

## Git Hygiene

- Check `git status --short` before staging.
- Stage only files relevant to the task.
- Leave unrelated user changes untouched.
- Do not use destructive git commands unless explicitly requested.
- Update cache-busting query strings when changed JS/CSS must refresh on GitHub Pages.
- Do not mention unrelated `.DS_Store` changes in final summaries; ignore them unless the task is specifically about repository hygiene.

## After Implementation

Before final response or PR:
- run relevant tests
- run JS syntax checks for browser script changes
- run `git diff --check`
- if a verification command cannot run because a tool is unavailable, explain why, run the closest equivalent if possible, and clearly label it as a substitute
- summarize changes clearly
- mention remaining risks and follow-up ideas

## Review Checklist

Ask:
- Did this change preserve the static app architecture?
- Did it preserve Supabase security assumptions?
- Did it avoid exposing participant PII or answer images?
- Did it use safe rendering for user-controlled text?
- Did it avoid unrelated UI, schema, or workflow changes?
- Are docs updated if future agents need the new context?

## Supporting Docs

Read these before larger changes:

- `docs/architecture.md`
- `docs/database.md`
- `docs/security.md`
- `docs/coding_rules.md`
- `docs/workflow.md`
- `docs/roadmap.md`
- `docs/features.md`
- `docs/page_structure.md`
- `docs/api.md`
- `docs/known_limitations.md`
