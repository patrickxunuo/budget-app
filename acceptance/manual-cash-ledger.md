# Manual/Cash Ledger - Acceptance Criteria

## Description (client-readable)

Signed-in household members can record cash and other off-bank activity in a dedicated Manual/Cash ledger. Personal records remain private to their author, while active family members can collaborate on Family records with durable authorship, edit, and deletion history.

## Interface Contract

### API Endpoints

| Method | Path                      | Request Body / Query                                                 | Response (success)                                       | Response (error)                                                                 |
| ------ | ------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/manual-entries`     | Optional `scope`, `from`, `to`, `categoryId`; optional `format=csv`  | `200 { entries: ManualEntry[] }` or a UTF-8 CSV download | `400 { error: { code, message, fields? } }`; `401/403` auth                      |
| POST   | `/api/manual-entries`     | `ManualEntryInput`                                                   | `201 { entry: ManualEntry }`                             | `400` validation; `401/403` auth                                                 |
| PATCH  | `/api/manual-entries/:id` | Partial editable fields from `ManualEntryInput` (scope is immutable) | `200 { entry: ManualEntry }`                             | `400` validation; `401/403`; `404` inaccessible/missing/deleted                  |
| DELETE | `/api/manual-entries/:id` | `{ confirmed: boolean }`                                             | `200 { entry: ManualEntry }` with deletion audit fields  | `400 family confirmation missing`; `401/403`; `404` inaccessible/missing/deleted |

All JSON errors use `{ error: { code: string, message: string, fields?: Record<string,string> } }`. Route params are awaited through Next.js 16 `RouteContext`.

### Data Models

```ts
type ManualEntryKind = "income" | "spending" | "refund";
type Scope = "family" | "personal";

type ManualEntryInput = {
  scope: Scope;
  kind: ManualEntryKind;
  amount: string; // canonical CAD decimal, max 2 fractional digits
  entryDate: string; // real YYYY-MM-DD calendar date
  description: string; // trimmed, 1..160 chars
  categoryId: string; // UUID, required
  notes?: string | null; // trimmed, max 1000 chars
};

type ManualEntry = {
  id: string;
  source: "manual";
  scope: Scope;
  ownerProfileId: string | null;
  kind: ManualEntryKind;
  amount: string; // positive income/refund, negative spending
  currencyCode: "CAD";
  entryDate: string;
  description: string;
  categoryId: string;
  notes: string | null;
  createdBy: string;
  lastEditedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
};
```

### Business Rules

1. Manual entries never have an account, Plaid item, provider transaction ID, pending link, or automatic reconciliation path; `source` is always `manual`.
2. Amounts are finite CAD decimal strings within the database precision and exactly follow signs: income/refund are greater than zero; spending is less than zero; zero is invalid. Client and server enforce the same rules, and PostgreSQL remains the final invariant.
3. `entryDate` is a real local calendar date. Description and category are required. The selected category must be active and in the same workspace/privacy domain as the entry.
4. Personal entries set `ownerProfileId` to the author and only that member can select, edit, or delete them. Scope and owner never change after creation.
5. Family entries have no owner; every active workspace member can create, edit, and soft-delete them. Family deletion requires `{ confirmed: true }`.
6. Every record retains `createdBy`; create/update sets `lastEditedBy`; deletion sets `deletedAt` and `deletedBy` instead of hard deleting. Deleted entries are excluded from normal lists, summaries, budgets, filters, and CSV exports but remain auditable.
7. Refund entries are positive cash flow and offset spending/category spending under existing accounting semantics. Manual income, spending, and refunds participate in the same category/date filters and summaries as Plaid rows, without pending/transfer classification.
8. CSV columns are stable: `date,description,source,scope,kind,amount,currency,category,notes,created_by,last_edited_by`; values use RFC 4180 escaping and current filtered rows only.

### UI Components

`ManualEntryWorkbench` receives initial entries and accessible categories. Required selectors:

- `manual-entry-workbench`, `manual-entry-form`, `manual-entry-scope`, `manual-entry-kind`, `manual-entry-amount`, `manual-entry-date`, `manual-entry-description`, `manual-entry-category`, `manual-entry-notes`, `manual-entry-submit`, `manual-entry-error`, `manual-entry-export`
- Per row: `manual-entry-row-{id}`, `manual-entry-edit-{id}`, `manual-entry-delete-{id}`, `manual-entry-delete-confirm-{id}`, `manual-entry-delete-cancel-{id}`

The interface uses the existing editorial ledger design system, clearly labels Manual/Cash versus Plaid source, exposes authorship/edit history for Family rows, supports keyboard operation and responsive stacking, and never shows inaccessible Personal data.

## API Acceptance Tests

| ID      | Scenario                                                 | Expected Result                                                                     |
| ------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| API-001 | Active member lists entries with filters                 | Only visible, non-deleted rows in requested scope/date/category are returned        |
| API-002 | Create valid Personal income                             | `201`; owner/author/editor are actor; positive CAD amount retained                  |
| API-003 | Create valid Family spending and refund                  | `201`; owner is null; signed values and explicit kinds retained                     |
| API-004 | Reject invalid amount/sign/date/required/category fields | `400` structured field errors, no write                                             |
| API-005 | Edit own Personal entry                                  | `200`; immutable scope/author preserved and editor/time updated                     |
| API-006 | Another member targets a Personal entry                  | indistinguishable `404`; no read or mutation leak                                   |
| API-007 | Active member edits a Family entry                       | `200`; original author retained, last editor changed                                |
| API-008 | Delete Family entry without confirmation                 | `400`; row remains active                                                           |
| API-009 | Confirm Family delete or delete own Personal entry       | `200`; soft-deletion actor/time recorded and row disappears from normal list        |
| API-010 | Export filtered CSV                                      | correct columns, escaping, signs, scope/kind/source, and only filtered visible rows |
| API-011 | Unauthenticated or inactive member calls any route       | `401` or `403`; no write                                                            |

## Database Acceptance Tests

| ID     | Scenario                                                                             | Expected Result                                                  |
| ------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| DB-001 | Insert invalid currency, zero/wrong sign, invalid kind, or mismatched category scope | database rejects it                                              |
| DB-002 | Personal owner reads/updates/deletes while another member attempts access            | owner succeeds; other member sees no row                         |
| DB-003 | Active members collaborate on Family entries                                         | all can read/update/soft-delete; audit identities remain correct |
| DB-004 | Direct hard delete or identity/scope rewrite                                         | rejected; audit/history cannot be bypassed                       |

## Frontend Acceptance Tests

| ID     | User Action                                                | Expected Result                                                                                     |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| FE-001 | Create Personal income and Family spending/refund entries  | signed validation, explicit scope/kind, category/notes fields, success rows, and source labels work |
| FE-002 | Edit a visible record and handle a server validation error | form pre-fills; successful save updates row; error is accessible and preserves input                |
| FE-003 | Delete Personal then Family entry                          | Personal deletes directly; Family requires confirm/cancel controls before request                   |
| FE-004 | Use mobile/keyboard/reduced-motion view and CSV export     | layout remains usable, focus is visible, download works, screenshots are captured                   |

## Test Status

- [x] API-001..API-011: PASS (route/unit suite)
- [x] DB-001..DB-004: PASS (pgTAP; full database suite 312 assertions)
- [x] FE-001..FE-004: PASS (component suite); Playwright coverage authored for desktop/mobile and fixture-gated when member credentials are absent
