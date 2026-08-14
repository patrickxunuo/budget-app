# Production / Trial smoke checklist

The manual pass that has to be green before a Plaid **Trial** or **Production**
release is announced to the household. It exercises the one thing no automated
suite in this repository can: a real Canadian institution, over real OAuth,
returning real accounts.

`pnpm smoke:plaid` (`scripts/plaid-sandbox-smoke.mjs`) is the runnable Sandbox
counterpart of this document. Its numbered checks match the numbers below, so a
Sandbox failure tells you which step of this checklist to expect trouble in.
It refuses to run outside Sandbox and can never touch a real member's data.

Every recorded defect in `memory-bank/testBaseline.md` under "Bugs Discovered"
was found by hand against a real institution, not by the suite. This checklist
is that hand.

---

## Preconditions

Do not start until all of these hold.

- [ ] Plaid **Trial or Production** access is approved for the account whose
      `PLAID_CLIENT_ID` you are about to deploy.
- [ ] The Vercel project has every variable from `.env.example` set, with
      `PLAID_ENV=trial` or `production`, and an **HTTPS** `APP_URL`.
- [ ] `https://<your-domain>/accounts` is registered as an allowed **OAuth
      redirect URI** in the Plaid dashboard. `oauthRedirectUri()` omits the
      field for non-HTTPS origins, so a wrong `APP_URL` fails silently at link
      time, not at deploy time.
- [ ] `PLAID_WEBHOOK_URL` points at `https://<your-domain>/api/plaid/webhook`
      and is publicly reachable.
- [ ] `PLAID_TOKEN_ENCRYPTION_KEY` is the **same value** the existing stored
      tokens were encrypted with. Rotating it makes every stored token
      undecryptable and every connection unrecoverable.
- [ ] **Migrations are applied.** See the note below this list; this is the most
      common cause of a smoke pass that behaves like a code bug.
- [ ] You have a **disposable** test institution login, or explicit consent to
      link and then disconnect a real one. Step 10 removes the Item.
- [ ] `pnpm test`, `pnpm test:db`, `pnpm test:e2e`, and `pnpm smoke:plaid` are
      green on the commit being deployed.

### On migrations

A Vercel deploy ships application code only. Any change under
`supabase/migrations/` must be pushed separately, or a SQL-only fix appears to
have no effect in production:

```bash
pnpm exec supabase db push --linked
```

Confirm what the hosted database actually holds before diagnosing anything
else, for example:

```sql
select prosrc like '%some removed text%' as still_old
from pg_proc where proname = 'commit_plaid_sync';
```

---

## Checklist

Work top to bottom. Do not skip ahead: each step assumes the previous one
passed. Record the actual observation next to each box, not just a tick.

### 1. Link token creation

- **Do:** Sign in as an active member, open **Accounts**, press _Connect a bank_.
- **Pass:** Plaid Link opens with a Canadian institution list. The network tab
  shows `POST /api/plaid/link-token` returning `200`.
- **Fail:** `INVALID_FIELD` on `redirect_uri` means `APP_URL` is not the HTTPS
  origin registered in the Plaid dashboard. Stop; fix the variable and redeploy.

### 2. Canadian Transactions entitlement

- **Do:** Search the institution you intend to link.
- **Pass:** It appears, and the consent screen names **Transactions** only —
  never a payment or transfer permission.
- **Fail:** An empty or US-only list means the client ID lacks CA Transactions
  entitlement. Stop; this is a Plaid dashboard change, not a code change.

### 3. Item exchange

- **Do:** Complete the institution's real login and any MFA.
- **Pass:** You return to `/accounts` and the review screen renders. `POST
/api/plaid/exchange` returns `200`.
- **Fail:** A returned-but-blank review screen usually means `balanceCents`
  rejected a balance. Capture the institution name and the account subtypes
  before retrying.

### 4. Institution lookup and account review

- **Do:** Read the review list carefully.
- **Pass:** The institution name is correct; every account is listed with a
  masked number; ineligible accounts (non-CAD, or a type outside chequing /
  savings / credit card) are shown **with a reason**, not hidden.
- **Fail:** A missing account is worse than an ineligible one. Real institutions
  return investment, loan, and deposit subtypes the Sandbox fixture does not;
  note every subtype that appeared.

### 5. CAD account selection and scope

- **Do:** Select at least one Family account and one Personal account, then
  activate.
- **Pass:** Activation reports the account count and either a completed or a
  pending import. Family and Personal choices are independent and stated
  plainly.
- **Fail:** If activation succeeded but the import failed, that is a retryable
  pending state, not a failed activation — continue to step 6 rather than
  relinking.

### 6. Initial import

- **Do:** Wait for the initial import, then open **Transactions**.
- **Pass:** Transactions appear with CAD amounts, correct signs, and a
  Family/Personal label matching the scope chosen in step 5. No transaction
  from an unselected account is visible.
- **Fail:** `unknown item account` in the logs means the sync received activity
  for an account the member never linked. Capture the account subtype list from
  step 4.

### 7. Manual sync

- **Do:** Return to **Accounts** and press _Check for updates_.
- **Pass:** `POST /api/plaid/sync` returns `200`, the button disables then
  re-enables, and the freshness line updates. Running it twice in a row does not
  duplicate a single transaction.
- **Fail:** Any error text containing `ITEM_`, `access-`, or a `request_id` has
  leaked provider internals into the UI. Record the exact string.

### 8. Webhook receipt

- **Do:** In the Plaid dashboard, fire a `TRANSACTIONS` / `SYNC_UPDATES_AVAILABLE`
  test webhook at `PLAID_WEBHOOK_URL`.
- **Pass:** The endpoint returns `200`, and the Accounts freshness line moves
  without anyone pressing anything. This is the only step no local run can
  cover, because signature verification needs a publicly reachable URL.
- **Fail:** `400` after a valid signature usually means the payload schema
  rejected a field Plaid actually sends (an explicit `"error": null`, for
  example). `429` means the webhook rate limit fired — re-fire once, slowly.

### 9. Dashboard, budgets, and CSV

- **Do:** Open **Dashboard** (Family, then Personal), **Budgets**, then export
  a filtered CSV.
- **Pass:**
  - Family and Personal totals differ, and no "Combined" control exists
    anywhere.
  - Cash flow, category spend, and cached balances render with a freshness
    stamp.
  - Budget progress shows spent / remaining / percentage with a non-colour
    state indicator.
  - The CSV filename matches the applied scope and date range, opens in a
    spreadsheet without a formula warning, and contains only the rows the
    screen showed.
- **Fail:** A Personal figure visible while the Family scope is selected is a
  privacy defect. Stop the release immediately and escalate.

### 10. Destructive-confirmation dry run

Do this on the disposable fixture only.

- **Do:** Open **Settings → Members**. Type a _wrong_ workspace name into the
  workspace deletion field and a _wrong_ phrase into the account deletion field.
- **Pass:** Both confirm buttons stay disabled. No request is sent. Then, with
  the **correct** phrase, disconnect the Item created in step 3 using _keep
  history_.
- **Pass:** Disconnect reports success, Plaid access is revoked (the Item
  disappears from the Plaid dashboard), and the historical transactions remain
  readable and read-only.
- **Fail:** A disconnect that reports success while the Item is still active in
  the Plaid dashboard is the worst outcome on this list. Escalate before
  anything else.

---

## What a pass looks like overall

All ten steps observed and recorded, with:

- no provider identifier, access token, `request_id`, or raw provider error in
  any user-visible string;
- no figure from one privacy scope visible in the other;
- the linked Item revoked at Plaid at the end of step 10.

Record the result, the institution used, and the date in
`memory-bank/testBaseline.md`.

## On failure

1. **Stop.** Do not proceed to the next step; later steps assume earlier state.
2. Capture the institution name, the account types it returned, the exact
   user-visible message, and the server log line — with the whole redacted
   context object, not a summary.
3. Decide the class of failure:
   - **Configuration** (steps 1, 2, 8): a dashboard or environment-variable
     change. No code rollback needed; fix and re-run from step 1.
   - **Schema** (steps 3, 6, 7): usually a migration that never reached the
     hosted database. Re-check `supabase db push --linked` before blaming code.
   - **Correctness or privacy** (steps 6, 9, 10): roll back.

## Rollback and escalation

- **Roll back the application** by promoting the previous Vercel deployment.
  This is instant and safe on its own.
- **Migrations do not roll back with it.** A deployment rollback leaves the new
  schema in place. If the failing change included a migration, write and push a
  forward migration; do not hand-edit the hosted database.
- **Revoke first, investigate second.** If a privacy or a revocation failure is
  suspected, disconnect the affected Item from the Plaid dashboard immediately.
  A revoked Item can be relinked; a leaked one cannot be un-read.
- Escalate any step 9 or step 10 failure to the workspace owner before the next
  deploy attempt, and record it under "Bugs Discovered" in
  `memory-bank/testBaseline.md`.
