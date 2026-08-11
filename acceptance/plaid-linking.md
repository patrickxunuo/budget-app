# Read-only Canadian Plaid Linking - Acceptance Criteria

## Description (client-readable)

An active family member can securely connect a Canadian bank through Plaid, review every returned account, and choose which eligible accounts remain Personal or become visible to the Family. Plaid credentials and access tokens remain server-only, unsupported accounts are explained clearly, and likely duplicate Family accounts require an explicit override.

## Interface Contract

This is the shared agreement between the Test Writer and the Implementer. The browser calls only the authenticated application endpoints below; it never receives a Plaid access token or a Supabase service-role credential.

### API Endpoints

| Method | Path                    | Request body                                                                  | Success response                                                                 | Error response                                                                                               |
| ------ | ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/plaid/link-token` | `{}`                                                                          | `200 { linkToken: string, expiration: string }`                                  | `401/403/422/502 { code: string, message: string }`                                                          |
| POST   | `/api/plaid/exchange`   | `{ publicToken: string, institution: { id: string, name: string } }`          | `200 { reviewId: string, institution: { id, name }, accounts: ReviewAccount[] }` | `400/401/403/409/422/502 { code, message }`                                                                  |
| POST   | `/api/plaid/activate`   | `{ reviewId: string, accounts: { providerAccountId: string, scope: "personal" | "family", acceptDuplicate?: boolean }[] }`                                       | `200 { itemId: string, activatedAccountIds: string[], importedTransactions: number, importStatus: "complete" | "pending" }` | `400/401/403/409/410/422/502 { code, message, fieldErrors?: Record<string,string[]> }` |

All three endpoints require a valid, non-expired Supabase session and active workspace membership. JSON errors are sanitized and never include Plaid secrets, public/access tokens, raw provider payloads, or service-role details.

### Data Models

```ts
type ReviewAccount = {
  providerAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currencyCode: string | null;
  eligible: boolean;
  eligibilityMessage: string | null;
  defaultScope: "personal";
  duplicate: null | {
    accountId: string;
    displayName: string;
    institutionName: string;
    mask: string | null;
  };
};
```

- `plaid_items` gains a `pending` lifecycle state. Each row remains bound to one workspace and its `linked_by` profile and stores only authenticated ciphertext plus a positive key version.
- A service-only pending-candidate table records every Plaid-returned account for review. Normal browser/PostgREST roles receive no privileges on this table.
- Activation is performed by one database transaction/RPC that re-validates review ownership, account eligibility, requested scope, duplicate overrides, and the pending Item state before inserting accounts and marking the Item active.
- New accounts default to `personal`, with `owner_profile_id = linked_by`. Family activation sets `owner_profile_id = null`.

### Business Rules

1. Link-token creation always sends `country_codes: ["CA"]`, `products: ["transactions"]`, `transactions.days_requested: 365`, the configured webhook URL, a stable client user id derived from the authenticated user, and the configured `/accounts` OAuth redirect. It never requests Auth, Transfer, Signal, Payment Initiation, Identity, or any money-movement product.
2. Sandbox uses Plaid Sandbox; Production and Plaid Trial use the production endpoint with server-only credentials. Browser bundles contain no Plaid secret or encryption key.
3. Public-token exchange occurs only on the server. The access token is encrypted with AES-256-GCM (fresh nonce and authentication tag) under the configured key before persistence and is never returned or logged.
4. Every Plaid-returned account appears in review. Only CAD depository/chequing, depository/savings, and credit/credit-card accounts are eligible. Other currency/type/subtype combinations remain visible with an actionable explanation and cannot be activated.
5. Eligible accounts start selected as Personal. The member may opt each account into Family independently, including mixed Personal and Family scopes within one Plaid Item.
6. A likely Family duplicate matches an existing active Family account on institution, normalized account type/subtype, normalized name, and masked digits. Activation returns `409 duplicate_account` unless that account submission includes `acceptDuplicate: true`; Personal accounts do not trigger Family duplicate warnings.
7. At least one eligible account must be activated. Submitted provider account ids must belong to the authenticated member's unexpired pending review and may appear only once.
8. Initial import paginates Plaid Transactions Sync, persists only transactions belonging to activated accounts, and is idempotent by provider transaction id. `PRODUCT_NOT_READY` is a successful `pending` import with zero or partial imported rows; ongoing webhook synchronization belongs to GH-5.
9. Link cancellation makes no exchange request and leaves the user on Accounts with a neutral retry message. Invalid/expired Link tokens, OAuth return failures, network failures, and partial eligibility have distinct actionable messages.
10. Pending reviews expire and cannot be activated after expiry. Failed exchange/activation does not expose or orphan plaintext tokens.
11. Sensitive server modules import `server-only`; privileged writes are narrow and auditable.

### UI Components

- `/accounts` is an authenticated Server Component shell that renders the interactive `PlaidLinkFlow` client island.
- The visual direction is an editorial connection dossier integrated with the existing mineral-green ledger theme: a strong connection status rail, dense but calm account review rows, and explicit Personal/Family privacy language.
- Required selectors: `plaid-connect`, `plaid-status`, `plaid-review`, `plaid-account-{providerAccountId}`, `plaid-account-{providerAccountId}-selected`, `plaid-account-{providerAccountId}-scope-personal`, `plaid-account-{providerAccountId}-scope-family`, `plaid-account-{providerAccountId}-eligibility`, `plaid-account-{providerAccountId}-duplicate`, `plaid-activate`, and `plaid-retry`.
- Disabled/ineligible controls remain keyboard-readable; focus is visible; status changes use an appropriate live region; motion respects `prefers-reduced-motion`.
- The application navigation exposes an active Accounts link on mobile and desktop.

## API Acceptance Tests

| ID      | Scenario                                                                          | Expected result                                                                                                       |
| ------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| API-001 | Active member creates a Link token                                                | Plaid receives exactly CA + Transactions + 365-day + webhook/OAuth configuration; response is sanitized               |
| API-002 | Anonymous or inactive member creates a token                                      | `401` or `403`; Plaid is not called                                                                                   |
| API-003 | Plaid token creation fails                                                        | `502` with stable actionable code/message and no secret data                                                          |
| API-004 | Valid public token is exchanged                                                   | Token is encrypted, pending Item/candidates are stored, and all accounts are returned for review without access token |
| API-005 | Exchange includes unsupported/non-CAD accounts                                    | They are returned as ineligible with actionable messages and cannot later activate                                    |
| API-006 | Invalid/expired public token or duplicate Item is exchanged                       | Stable `422`/`409` response; no plaintext token is persisted or returned                                              |
| API-007 | Member activates mixed Personal/Family accounts                                   | Atomic activation writes correct owners/scopes and marks the Item active                                              |
| API-008 | Likely Family duplicate is not overridden                                         | `409 duplicate_account`; no partial activation                                                                        |
| API-009 | Likely Family duplicate is explicitly overridden                                  | Activation succeeds and records the override/audit detail                                                             |
| API-010 | Activation submits an ineligible, foreign, duplicate, empty, or expired selection | Stable `400/403/410/422`; no partial activation                                                                       |
| API-011 | Initial Transactions Sync has multiple pages/repeated ids                         | Only selected-account rows are idempotently imported and count is correct                                             |
| API-012 | Plaid reports initial product not ready                                           | Activation succeeds with `importStatus: "pending"` and sanitized state                                                |
| API-013 | Encryption round trip and tamper detection                                        | Plaintext round-trips only with the right key; modified payload/key fails authentication                              |
| API-014 | Environment configuration selects Sandbox vs Production/Trial                     | Correct Plaid endpoint is used without client exposure                                                                |
| API-015 | Database privilege and default checks                                             | Pending candidates/tokens are service-only; new account default and ownership invariants are Personal-safe            |

## Frontend Acceptance Tests

| ID | User action | Expected result |
| --- | --- |
| FE-001 | Open Accounts and start linking | A real Link token is requested and Plaid Link opens from `plaid-connect` |
| FE-002 | Cancel Plaid Link | No exchange call occurs; neutral retry guidance appears |
| FE-003 | Complete Link with eligible and ineligible accounts | Every account appears; ineligible rows explain why and cannot be selected |
| FE-004 | Choose mixed Personal and Family visibility | Per-account controls retain independent choices and privacy copy is explicit |
| FE-005 | Submit a likely Family duplicate | Warning appears with an explicit override control before retrying activation |
| FE-006 | Complete activation | Success state reports activated account count and complete/pending import status |
| FE-007 | Return through OAuth or encounter expired/invalid token | Flow resumes with the stored Link token or presents a focused retry state without losing the page |
| FE-008 | Use mobile viewport, keyboard, or reduced motion | Review remains operable, responsive, focus-visible, and motion-safe |

Playwright journeys must call the application normally without `page.route`, MSW, or browser-side API stubs. Deterministic external-provider behavior may be supplied only through a server-side Plaid provider adapter selected by the E2E environment.

## Test Status

- [x] API-001 through API-014: PASS — 49 Vitest route/service/provider/client/crypto/account-rule checks, including canonical institution identity and environment routing
- [x] API-015: PASS — 217 pgTAP migration, privilege, lifecycle, advisory-lock, default, and RPC assertions across the database suite
- [x] FE-001 through FE-004: PASS — desktop and mobile Chromium
- [ ] FE-005: AUTHORED / FIXTURE-SKIPPED — duplicate reject/override behavior is green at API-008/API-009; browser execution requires a pre-existing matching Family-account fixture
- [x] FE-006 through FE-008: PASS — desktop and mobile Chromium

Screenshots are captured under `test-results/` for account review, activation success, OAuth retry, and mobile keyboard/reduced-motion review; the HTML report is generated under `playwright-report/`.
