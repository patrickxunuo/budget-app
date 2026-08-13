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
- Destructive workspace lifecycle: page every Plaid Item and cross the provider boundary through durable claim phases before local purge; serialize optional member emails with service-only recipient claims and deterministic message IDs; let only a service-role finalizer choose notification policy while it rechecks actor ownership, recent confirmation, current membership coverage, and exact workspace name.
- CSV portability: export through the same complete scoped/filter-aware read model as the displayed ledger, serialize only an explicit safe-column allowlist, use UTF-8 RFC 4180 output, and neutralize user-controlled spreadsheet formula prefixes without treating trusted numeric amounts as text.
- Plaid lifecycle mutations: keep pending candidates and encrypted access tokens service-only, revoke authenticated writes to protected Item/account state, and activate reviewed accounts through one fixed-search-path RPC.
- Plaid duplicate identity: compare immutable provider-backed institution, type/subtype, normalized name, and mask fields; never use user-editable display names, and fail closed when duplicate lookup cannot complete.
- External activation boundaries: once database activation commits, downstream import failures are retryable pending states rather than false activation failures; return only sanitized sync state and preserve idempotent partial progress.
- Plaid transaction sync: claim each Item with a request ID, buffer the complete `/transactions/sync` page pass, then commit changes and the final cursor in one service-role RPC with cursor/claim/Item-state revalidation; persist only sanitized retry and support correlation state.
- Transaction accounting: retain provider amounts in Plaid's source convention and user choices in `transaction_metadata`; convert to safe integer cents at the domain boundary, classify with exact primary/detail mappings (never merchant-name substrings), exclude transfers from ordinary totals, net refunds against category spending, and reconcile pending predecessors before aggregation.
- Complete ledger reads: page through Supabase's configured row cap with stable unique ordering before calculating summaries or CSV exports; apply shared scope/date/category filters before display slicing so pagination never changes accounting totals.
- Financial read scopes: every dashboard, transaction, and Manual/Cash list read requires an explicit Family or signed-in-member Personal scope; never aggregate or expose a Combined privacy view, and apply pending reconciliation before range/search filters.
- Monthly budgets: store safe CAD cents in effective-dated, non-overlapping category versions; serialize create/revise/archive RPCs by privacy-domain/category advisory locks, mutate only the current open version, preserve historical cutoffs, and expand dashboard targets once per touched local calendar month.
- Manual/Cash ledger: keep off-bank rows accountless and outside Plaid reconciliation; mutate them only through fixed-search-path RPCs, preserve immutable scope/authorship, use audited soft deletion, and combine their explicit signed kinds with Plaid only at the accounting boundary.
- Session security: bind signed HttpOnly recovery and absolute-session state to the Auth user; recovery state is short-lived and single-use, while protected sessions expire absolutely after 30 days.
- RLS helpers: place narrow `security definer` predicates in the non-exposed `private` schema, pin `search_path`, revoke default execution, and authorize both a child row and its underlying parent privacy domain.
- Privacy-domain invariants: scoped category references must match workspace/scope/owner; deferred triggers enforce cross-table owner consistency; guarded scope fields prevent shared data from being privatized indirectly.
- Merchant categorization: derive stable merchant identity again inside authenticated mutation RPCs, treat provider entity IDs as opaque case-sensitive values, normalize only name fallbacks, and keep manual overrides above rules and Plaid defaults.
- Validation: Zod validates environment boundaries before clients are constructed.

## API Conventions

- Next.js App Router server/client boundaries; internal maintenance routes require constant-time bearer-secret authorization.
- Auth sessions use Supabase SSR cookies plus a signed absolute-session-start cookie enforced by the proxy and protected DAL.

## Known Pitfalls

- Run `next typegen` before `tsc --noEmit`; fresh checkouts do not contain generated route types.
- Treat formatting as a required pre-commit gate, not a post-review cleanup: run `pnpm format:check` with the committed lockfile before pushing, and run `git diff --check` to catch whitespace that Prettier may not report. For every new or edited SQL migration, leave exactly one newline at EOF with no trailing blank lines. On Windows, repository-wide Prettier can be distorted by CRLF materialization, so also run Prettier against every changed supported file and rely on the Linux CI-equivalent check before declaring the branch ready.
- A family owner must never bypass another member's Personal-data RLS.
- Supabase service-role clients bypass RLS and must remain inaccessible to browsers.
- Rollback-only pgTAP files do not naturally fire deferred constraints; force them with `set constraints all immediate` in regression tests.
