# System Patterns

## Project Structure

- `src/app/`: App Router pages, layouts, and framework error boundaries.
- `src/components/`: shared presentation components.
- `src/lib/env/`: public and server environment contracts.
- `src/lib/supabase/`: browser, SSR, and privileged server client factories.
- `src/lib/plaid/`: server-only Plaid integration.
- `e2e/`: Playwright browser journeys.

## Naming Conventions

- TypeScript files: kebab-case where descriptive; App Router framework filenames where required.
- Components and types: PascalCase; functions and variables: camelCase.
- Database tables and columns: snake_case.

## Code Patterns

- Server-only secrets: privileged modules import `server-only`; only `NEXT_PUBLIC_*` values may enter browser code.
- Supabase boundaries: separate browser, SSR, and service-role client factories.
- Authorization: database RLS is the primary boundary; privileged server paths must be narrow and documented.
- Auth lifecycle mutations: expose setup and invitation finalization only to the service role; expose membership changes only through fixed-search-path RPCs, and revoke direct table writes that could bypass recent-password checks.
- Cross-system deletion: enqueue Auth identity deletion transactionally before deleting database state, process the service-only outbox idempotently, and retain failures for a bearer-protected retry worker.
- Plaid lifecycle mutations: keep pending candidates and encrypted access tokens service-only, revoke authenticated writes to protected Item/account state, and activate reviewed accounts through one fixed-search-path RPC.
- Plaid duplicate identity: compare immutable provider-backed institution, type/subtype, normalized name, and mask fields; never use user-editable display names, and fail closed when duplicate lookup cannot complete.
- External activation boundaries: once database activation commits, downstream import failures are retryable pending states rather than false activation failures; return only sanitized sync state and preserve idempotent partial progress.
- Plaid transaction sync: claim each Item with a request ID, buffer the complete `/transactions/sync` page pass, then commit changes and the final cursor in one service-role RPC with cursor/claim/Item-state revalidation; persist only sanitized retry and support correlation state.
- Session security: bind signed HttpOnly recovery and absolute-session state to the Auth user; recovery state is short-lived and single-use, while protected sessions expire absolutely after 30 days.
- RLS helpers: place narrow `security definer` predicates in the non-exposed `private` schema, pin `search_path`, revoke default execution, and authorize both a child row and its underlying parent privacy domain.
- Privacy-domain invariants: scoped category references must match workspace/scope/owner; deferred triggers enforce cross-table owner consistency; guarded scope fields prevent shared data from being privatized indirectly.
- Validation: Zod validates environment boundaries before clients are constructed.

## API Conventions

- Next.js App Router server/client boundaries; internal maintenance routes require constant-time bearer-secret authorization.
- Auth sessions use Supabase SSR cookies plus a signed absolute-session-start cookie enforced by the proxy and protected DAL.

## Known Pitfalls

- Run `next typegen` before `tsc --noEmit`; fresh checkouts do not contain generated route types.
- A family owner must never bypass another member's Personal-data RLS.
- Supabase service-role clients bypass RLS and must remain inaccessible to browsers.
- Rollback-only pgTAP files do not naturally fire deferred constraints; force them with `set constraints all immediate` in regression tests.
