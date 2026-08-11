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
- RLS helpers: place narrow `security definer` predicates in the non-exposed `private` schema, pin `search_path`, revoke default execution, and authorize both a child row and its underlying parent privacy domain.
- Privacy-domain invariants: scoped category references must match workspace/scope/owner; deferred triggers enforce cross-table owner consistency; guarded scope fields prevent shared data from being privatized indirectly.
- Validation: Zod validates environment boundaries before clients are constructed.

## API Conventions

- Next.js App Router server/client boundaries; API routes are not yet implemented.
- Auth sessions use Supabase SSR cookies; session-refresh enforcement is planned in GH-3.

## Known Pitfalls

- Run `next typegen` before `tsc --noEmit`; fresh checkouts do not contain generated route types.
- A family owner must never bypass another member's Personal-data RLS.
- Supabase service-role clients bypass RLS and must remain inaccessible to browsers.
- Rollback-only pgTAP files do not naturally fire deferred constraints; force them with `set constraints all immediate` in regression tests.
