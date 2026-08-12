# Scoped Categories and Merchant Rules - Acceptance Criteria

## Description

Household members can organize imported transactions with Plaid-backed defaults, shared Family categories, private Personal categories, one-off corrections, and durable merchant rules. Plaid source facts remain visible and immutable while the app records who changed the effective category and when.

## Interface Contract

### API endpoints

| Method  | Path                             | Request                                               | Success                                                                            | Errors                            |
| ------- | -------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------- |
| `GET`   | `/api/categories`                | none                                                  | `200 { categories, rules }` containing only categories/rules visible to the caller | `401`, `403`                      |
| `POST`  | `/api/categories`                | `{ name, color, scope }`                              | `201 { category }`                                                                 | `400`, `401`, `403`, `409`        |
| `PATCH` | `/api/categories/:id`            | `{ name?, color?, archived? }`                        | `200 { category }`                                                                 | `400`, `401`, `403`, `404`, `409` |
| `GET`   | `/api/transactions?limit=50`     | optional `limit` from 1-100                           | `200 { transactions }` newest first                                                | `400`, `401`, `403`               |
| `PATCH` | `/api/transactions/:id/category` | `{ categoryId }`                                      | `200 { transaction }` with `effectiveCategory.source = "manual"`                   | `400`, `401`, `403`, `404`        |
| `POST`  | `/api/merchant-rules/preview`    | `{ transactionId, categoryId, scope }`                | `200 { matcher, matchCount }`                                                      | `400`, `401`, `403`, `404`        |
| `POST`  | `/api/merchant-rules`            | `{ transactionId, categoryId, scope, applyExisting }` | `201 { rule, updatedCount }`                                                       | `400`, `401`, `403`, `404`, `409` |
| `PATCH` | `/api/merchant-rules/:id`        | `{ categoryId?, enabled?, archived? }`                | `200 { rule }`                                                                     | `400`, `401`, `403`, `404`, `409` |

Errors use `{ error: string, fields?: Record<string, string[]> }` and never expose database/provider internals. Every handler authenticates independently. Dynamic route handlers use Next 16's async `RouteContext<"/.../[id]">` params contract.

### Data models

- `Category`: `{ id, name, color, scope: "family" | "personal", ownerProfileId, systemKey, archivedAt, inUse }`.
- Supported Plaid PFC definitions are seeded from versioned SQL, not Plaid's deprecated categories endpoint. System categories use stable `systemKey` values and cannot be renamed or archived.
- `EffectiveCategory`: `{ id, name, color, source: "plaid" | "rule" | "manual", updatedBy, updatedAt } | null`.
- `OriginalPlaidCategory`: `{ primary, detailed } | null`, derived only from immutable `transactions.provider_payload.personalFinanceCategory`.
- `TransactionCategoryView`: `{ id, merchantName, name, amount, transactionDate, pending, scope, ownerProfileId, originalPlaidCategory, effectiveCategory, stableMerchantId, normalizedMerchant }`.
- `MerchantRule`: `{ id, categoryId, scope, ownerProfileId, matchType: "merchant_id" | "normalized_name", matchValue, enabled, archivedAt, createdBy, createdAt, updatedAt }`.

### Business rules

1. Seed a supported Plaid Personal Finance Category catalog in a migration; runtime behavior never calls the deprecated Plaid categories endpoint.
2. Original Plaid PFC values remain provider-owned and visible beside the app-owned effective category. A later Plaid sync may update the original but never overwrites a manual override.
3. Effective-category precedence is `manual > merchant rule > seeded Plaid default > uncategorized`.
4. Every active member may create/manage Family categories and rules. Personal categories/rules are visible and mutable only by their creator, including from the family owner.
5. Recategorization must select a visible category in the transaction's own workspace/privacy domain. It records actor and timestamp without changing transaction amount, date, merchant, pending status, or provider payload.
6. Merchant matching uses a stable Plaid merchant/entity identity when present. Otherwise it uses a conservative Unicode-normalized, lowercase, whitespace-collapsed merchant/name fallback. Blank or unsafe fallbacks are rejected.
7. Preview and apply use the same matcher and privacy scope. The preview count excludes removed transactions and transactions carrying manual overrides.
8. Creating an enabled rule can atomically apply it to matching existing visible transactions; future Plaid sync commits apply it only when no manual override exists.
9. A Personal rule never changes Family or another member's Personal metadata. A Family rule only changes Family-account transactions.
10. Custom categories referenced by metadata, rules, manual entries, or budgets are archived instead of deleted. Unused custom categories may also be archived; built-ins remain active.
11. Shared category/rule create, update, archive, and apply operations append `audit_events` with actor and timestamp. Personal operations remain private but retain actor/timestamps on their own records.
12. Conflicts, invalid scope changes, inaccessible identifiers, and duplicate active names/matchers fail closed with sanitized responses.

### UI contract

- `/categories` renders `data-testid="category-workbench"`, scoped category lists, a create form (`category-name`, `category-color`, `category-scope`, `category-submit`), archive controls, and a merchant-rule register.
- `/transactions` renders `data-testid="transaction-ledger"`; each row uses `transaction-row-{id}`, shows `original-category-{id}` and `effective-category-{id}`, and provides `category-select-{id}` plus `category-save-{id}`.
- Rule creation opens from a transaction with `rule-create-{id}`, displays `rule-preview-count`, requires confirmation through `rule-confirm`, and announces success/error through an `aria-live` status region.
- The visual direction extends the existing editorial family-ledger design: dense but calm tabular rhythm, mineral/green palette, strong display typography, explicit privacy labels, responsive stacked transaction cards, keyboard focus, reduced-motion support, and no generic dashboard-card aesthetic.

## Acceptance tests

### Database and domain

- `DB-001`: migration seeds stable Plaid PFC definitions without external calls.
- `DB-002`: Family categories/rules are collaborative while Personal rows remain creator-only under RLS.
- `DB-003`: category references and rules cannot cross workspace or privacy domain.
- `DB-004`: in-use categories archive and built-ins reject rename/archive; no destructive delete is exposed.
- `DB-005`: rule preview/apply share a matcher, skip manual overrides, and record shared audit events.
- `DB-006`: future sync applies rule/default precedence without replacing manual overrides.
- `DOM-001`: normalization prefers stable merchant identity and rejects unsafe blank fallback.
- `DOM-002`: precedence resolves manual, rule, Plaid, and uncategorized in that order.
- `DOM-003`: request validation accepts only supported scopes, colors, UUIDs, limits, and mutation shapes.

### API

- `API-001`: visible category/rule list is privacy scoped.
- `API-002`: valid Family and Personal categories create with canonical names/colors.
- `API-003`: duplicate/invalid categories return sanitized validation/conflict errors.
- `API-004`: archiving a used custom category succeeds without deleting history.
- `API-005`: transaction list exposes original and effective categories separately.
- `API-006`: manual recategorization changes metadata only and records actor/time.
- `API-007`: preview returns the exact eligible existing-match count.
- `API-008`: confirmed rule creation reports updated count and preserves manual overrides.
- `API-009`: unauthenticated, cross-member Personal, and cross-domain mutations fail closed.

### Frontend and E2E

- `FE-001`: member creates Family and Personal categories and sees clear privacy labels.
- `FE-002`: member archives an in-use custom category and historical transaction labels remain intelligible.
- `FE-003`: transaction row shows original Plaid category beside effective category and saves a one-off override.
- `FE-004`: merchant-rule preview shows affected count before confirmation and success shows applied count.
- `FE-005`: desktop/mobile layouts, keyboard focus, reduced motion, and screenshots remain usable.

## Test Status

- [x] DB-001 through DB-006: PASS (GH-7 pgTAP suite; 292 database assertions total)
- [x] DOM-001 through DOM-003: PASS (domain/validation Vitest coverage)
- [x] API-001 through API-009: PASS (route acceptance coverage)
- [x] FE-001 through FE-004: PASS (component acceptance coverage; real-backend Playwright authored)
- [x] FE-005: PASS in component/build verification; desktop/mobile Playwright authored and fixture-gated in this run
