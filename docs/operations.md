# Operations runbook

This runbook is for the person operating a Budget App household on Vercel, hosted Supabase, and Plaid. Keep an offline copy of the recovery contacts for all three vendors. Never put credentials, access tokens, account numbers, database exports, or raw provider errors in GitHub issues or chat.

## Ownership and privacy boundary

Budget App is Canada/CAD only and uses Plaid **Transactions** read access. It cannot initiate a transfer, payment, or any other financial transaction.

Normal member access is enforced by Supabase row-level security:

- **Family** records are visible to active members of the household workspace.
- **Personal** records are visible only to the member who owns that privacy scope.
- There is no Combined view. An owner can manage membership but does not gain an application path into another member's Personal records.

That boundary does not protect data from the infrastructure administrator. Whoever controls the hosted Supabase organization/service-role key can read or change the underlying database, and whoever controls Vercel can read deployed secrets or replace application code. Treat that administrator as trusted, minimize the number of administrators, require MFA, review access regularly, and remove access promptly. A database dump is Personal data and needs the same protection as the live database.

The application is one installation, one workspace, not a multi-tenant SaaS service.

## Routine checks

At least after every deploy, vendor incident, or credential change:

1. Check Vercel deployment and function logs for sanitized failures. Do not copy unredacted provider context into a ticket.
2. Confirm the nightly `07:17 UTC` invocation of `/api/internal/plaid-sync` completed. It must carry `Authorization: Bearer <CRON_SECRET>`; this secret is distinct from all other credentials.
3. Confirm Plaid webhook delivery to `/api/plaid/webhook` returns `200` for a valid signed test event.
4. In **Accounts**, check connection health, last successful sync, consent expiry, and any retry/login-repair state.
5. In Supabase, confirm backups are succeeding under the plan you selected and periodically prove restore in an isolated project.
6. Test password recovery after an SMTP or auth-domain change.

The webhook provides prompt updates. The nightly cron catches missed notifications and stale Items. Both are safe to retry and should not duplicate transactions.

## Sessions, first owner, and invitations

The first visitor to `/setup` claims the installation and becomes the first owner. After that, public sign-up remains closed. The owner creates an expiring invite link in **Settings → Members**, sends it privately to the named recipient, and can revoke it before use. An invite link is a credential: do not post it publicly. Used, expired, revoked, or replayed links are rejected.

Protected sessions have an absolute 30-day application lifetime. Destructive membership, connection, account, and workspace actions require a recent password confirmation; that confirmation lasts 15 minutes. If an action asks for confirmation again, re-enter the password rather than weakening the policy.

Maintain an active owner at all times. An owner cannot delete their own account until ownership is transferred or the whole workspace is deleted.

## Back up and restore

The Supabase infrastructure administrator owns backup and restore; Budget App does not create or validate database backups.

### Backup practice

- Enable the hosted backup/PITR option appropriate to the household's recovery objective and verify current vendor retention rather than assuming it.
- Before a schema release, record the migration state and take/confirm a recoverable backup according to the selected Supabase plan.
- Store any manual logical export encrypted, access-controlled, and outside the source repository. It contains Family and Personal financial data.
- Preserve Vercel/Supabase/Plaid configuration separately; a database backup does not restore vendor dashboards or secrets.
- Test restoration periodically into a new isolated hosted Supabase project with no Plaid webhook and no live cron. Verify RLS and representative reads before deleting the exercise project.

### Restore and disaster recovery

1. Stop traffic or place the deployment behind operator-controlled access. Disable the cron and Plaid webhook target while state is uncertain.
2. Restore through the hosted Supabase procedure into an isolated project whenever possible. Never overwrite the only live copy as the first recovery attempt.
3. Link the repository CLI to the recovery project and compare applied migrations; apply only known, versioned forward migrations.
4. Point a non-public Vercel deployment at the recovered project using fresh service/cron secrets while retaining the correct `PLAID_TOKEN_ENCRYPTION_KEY` for the restored ciphertext.
5. Verify owner sign-in, Family/Personal isolation, account health, CSV output, and the [production smoke checklist](./production-smoke-checklist.md).
6. Re-enable webhook/cron only after validation. Reconcile from Plaid; the cursor-based sync is retryable.

A Vercel rollback changes application code only. It does not undo SQL. If a migration is faulty, restore according to the recovery plan or ship a reviewed forward migration; do not hand-edit production schema in place.

## Bank connection lifecycle

### Healthy sync and stale data

Use **Accounts → Check for updates** for a manual sync. Repeating it is safe. If data is stale:

1. Check the displayed last-success/retry time and connection status.
2. Confirm Vercel functions, the nightly cron, and the webhook endpoint are healthy.
3. Confirm the hosted migration state (`pnpm exec supabase db push --linked` should report no pending release migration; review before accepting changes).
4. Check Plaid dashboard Item status and current Canada Transactions entitlement.
5. Retry the manual sync after any provider backoff time. Do not relink immediately; a failed initial import can be a retryable pending state.

### Login, consent, and account repair

An Item/login error or expiring consent is surfaced as attention needed. Use the connection's **Repair** action (Plaid update mode) and choose the reason shown—login repair, consent, permissions, or account selection. Complete institution authentication, then run a manual refresh. Repair keeps the existing Item and history; creating a second connection can create duplicates and should not be the first remedy.

Provider codes, request IDs, access tokens, and raw provider messages must remain server-side. When seeking help, include the sanitized UI message, time, deployment, institution name, and redacted server correlation context.

### Disconnect: keep history or delete local data

Both disconnect modes operate on the whole Plaid Item, require recent password confirmation, and revoke provider access first:

- **Keep history** revokes the Item and stops future sync, while retaining imported transactions as read-only history.
- **Delete local data** revokes the Item, then permanently removes its linked accounts and imported local data. Export what is needed first. This irreversible choice is not recoverable through the UI.

If Plaid revocation cannot be confirmed, the operation fails closed and local deletion must not be treated as complete. Retry after provider recovery. For an urgent suspected exposure, revoke the Item directly in the Plaid dashboard first, then reconcile local state.

Unsupported account types and non-CAD accounts are shown as ineligible during link review and cannot be activated. Do not work around this by changing provider data or the database; Budget App supports chequing, savings, and credit-card accounts denominated in CAD.

## Export, membership, and deletion

### CSV export

Use the Transactions page's export action after selecting the exact Family or Personal scope, date range, category, and search filters. The CSV contains the complete filtered ledger visible to that scope—not merely the current screen page—and neutralizes spreadsheet-formula prefixes. Treat the file as sensitive financial data, store it encrypted, and delete copies according to household policy. CSV is a portability export, not a full database backup.

### Leaving or removing a member

Before leaving or removing someone, transfer ownership if necessary and export anything the departing person is entitled to retain.

- A non-owner may leave after recent password confirmation.
- The owner may remove a member after recent confirmation.
- The service revokes the departing member's Plaid Items before changing membership. If that cannot be confirmed, membership removal fails closed.
- Removal ends the member's application access and queues identity cleanup. Their Personal data and relevant authored data are permanently removed under database lifecycle rules; this is not an archival action.
- Family data remains with the workspace. No operator should export another member's Personal data through privileged database access except under an explicit, lawful recovery agreement.

### Delete an account

A non-owner can permanently delete their account after recent password confirmation and the required confirmation phrase. The app revokes that member's Plaid Items first. If any revocation is unresolved, nothing is finalized. The owner must transfer ownership or delete the workspace instead. Successful deletion signs the member out globally and removes their account/data according to the lifecycle rules.

### Delete the workspace

Only the owner may delete the entire workspace. The owner must recently confirm their password and type the workspace name exactly. Export all required data first.

Deletion revokes every Plaid Item before purging local state. When `SMTP_URL` and `SMTP_FROM` are configured, notification delivery to every active member is part of the fail-closed finalization. Any unresolved provider revocation, changed membership, or required notification failure stops final deletion. Success permanently deletes the workspace and member data, queues Auth identity cleanup, signs the owner out, and returns the installation to `/setup`. A Vercel rollback cannot undo it; recovery requires a valid infrastructure backup.

## Troubleshooting

### Webhook does not update data

- Confirm `PLAID_WEBHOOK_URL` is the public HTTPS `/api/plaid/webhook` URL and Plaid is sending a supported `TRANSACTIONS` event.
- Use a Plaid dashboard test webhook. A valid signed event should return `200`.
- `400` usually means invalid signature/body/schema; verify clock, public reachability, and deployed code. Never disable signature verification.
- `429` is rate limiting; retry once after waiting rather than flooding the endpoint.
- If webhooks remain unavailable, preserve the nightly cron and manual sync while repairing delivery.

### Nightly sync does not run

- Confirm `vercel.json` is deployed and the selected Vercel plan supports the declared cron schedule.
- Confirm `CRON_SECRET` exists and is the same value Vercel attaches to cron requests. It must not be the Plaid/encryption/Supabase secret.
- `401` means missing or wrong bearer authorization. Do not make the internal route public.
- Inspect per-Item retry state; one provider failure should not justify deleting an Item.

### Plaid link fails with `INVALID_FIELD`

For an HTTPS production `APP_URL`, register the exact `<APP_URL>/accounts` URL in Plaid before redeploying. Origin, scheme, host, port, path, and trailing slash must match. Local HTTP origins cannot link OAuth institutions; use a deployed HTTPS origin for those institutions.

### Plaid Item or login error

Use **Repair**, not a second link. Confirm the Item is enabled, consent has not expired, the application has Canada Transactions access, and the client ID/secret match `PLAID_ENV`. Complete update mode and refresh. If the provider reports an outage, wait for its retry window.

### Password recovery email does not arrive

- Verify Supabase custom SMTP is enabled, sender/domain authentication is valid, and the Supabase Site URL plus `/auth/confirm` redirect are correct.
- Check provider delivery/bounce logs and spam filtering without logging reset links.
- Confirm the request used the member's exact email. Responses are intentionally generic and do not reveal whether an account exists.
- If application lifecycle notification mail fails, verify both `SMTP_URL` and `SMTP_FROM`; they must be configured together.

### Installed PWA is stale or will not install

- Installation needs a supported browser and HTTPS (loopback is the development exception). Use `/install` for platform-specific steps.
- Budget App never caches financial pages/API responses for offline use. Offline mode intentionally shows no balances or transactions.
- When an update prompt appears, finish sensitive work, choose the update, and allow the single reload. If no prompt appears, close all Budget App tabs/windows and reopen; then clear only this site's service worker/cache if necessary.
- Check manifest, icons, service-worker registration, browser installability diagnostics, and that the app is not already installed. iPhone/iPad installation must start in Safari.

### Unsupported or non-CAD account

This is expected, not a sync bug. Only Canadian-dollar chequing, savings, and credit-card accounts can be activated. Other currencies, investment, loan, and unsupported deposit subtypes remain visible with an ineligibility reason. Use another supported account; do not coerce its currency or type.

### Encryption key was changed

Restore the previous `PLAID_TOKEN_ENCRYPTION_KEY` immediately if it is still securely available. The key is not derived from other credentials and existing tokens cannot be decrypted with a replacement. If it cannot be restored, revoke affected Items in Plaid and relink them; do not paste token ciphertext or keys into support reports.

## Incident and release escalation

A suspected Family/Personal data leak or failure to revoke Plaid access is release-blocking. Revoke affected Items first, restrict the deployment, preserve redacted logs, and use the private process in [`SECURITY.md`](../SECURITY.md). Promote the previous Vercel deployment when application code is implicated, while remembering that migrations remain in place.
