# Invite-only Family Authentication - Acceptance Criteria

## Description (client-readable)

Budget App has one private family workspace. The first person creates that workspace and becomes its owner; after setup, new people can join only through revocable, single-use, expiring links created by the owner. Members receive complete password and session flows while sensitive membership and deletion operations require fresh password confirmation.

## Interface Contract

### Server Actions

All actions return `AuthActionState`: `{ status: "idle" | "success" | "error"; message?: string; fieldErrors?: Record<string, string[]>; data?: Record<string, unknown> }`. Redirecting actions may redirect after success instead of returning success state. Every action validates untrusted `FormData`, authenticates at the point of mutation, and returns a non-enumerating error where revealing account or invitation existence would leak data.

| Action                 | Input fields                                        | Success                                                                                                                         | Important errors                                        |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `setupFamily`          | `displayName`, `workspaceName`, `email`, `password` | Creates auth user, profile, singleton workspace, active owner; redirects `/dashboard`                                           | setup closed, invalid input, email unavailable          |
| `signIn`               | `email`, `password`, optional `next`                | Establishes session; redirects to safe same-origin path or `/dashboard`                                                         | generic invalid credentials                             |
| `signOut`              | none                                                | Ends local/global session and redirects `/sign-in`                                                                              | generic retry message                                   |
| `requestPasswordReset` | `email`                                             | Always returns the same confirmation; requests Supabase recovery redirect to `/reset-password`                                  | invalid email                                           |
| `resetPassword`        | `password`, `confirmPassword`                       | Updates password, records recent confirmation, redirects `/dashboard`                                                           | invalid/expired recovery session                        |
| `createInvitation`     | `email`, `expiresInHours`                           | Owner-only; returns `{ invitationId, inviteUrl, expiresAt }`                                                                    | forbidden, duplicate active invite, invalid expiry      |
| `revokeInvitation`     | `invitationId`                                      | Owner-only; marks unresolved invitation revoked                                                                                 | forbidden, not found/already resolved                   |
| `acceptInvitation`     | `token`, `displayName`, `password`                  | Creates invite-bound auth user, profile, active member and consumes token; redirects `/dashboard`                               | generic invalid/expired/used invite                     |
| `confirmPassword`      | `password`                                          | Reauthenticates and records a 15-minute recent-confirmation timestamp in an HttpOnly, Secure-in-production, SameSite=Lax cookie | invalid password                                        |
| `leaveWorkspace`       | none                                                | Active member becomes inactive, access is revoked, their Plaid Items are disconnected, and Personal data is deleted             | owner must transfer first, recent confirmation required |
| `removeMember`         | `membershipId`                                      | Owner-only equivalent of leave for another member                                                                               | cannot remove owner/self, recent confirmation required  |
| `transferOwnership`    | `membershipId`                                      | Atomically promotes active member and demotes current owner                                                                     | invalid target, recent confirmation required            |
| `deleteAccount`        | none                                                | Deletes caller's Personal data and auth identity after safe workspace departure                                                 | owner must transfer first, recent confirmation required |
| `deleteWorkspace`      | `workspaceName`                                     | Sole owner only; deletes workspace data and caller auth identity                                                                | confirmation mismatch, recent confirmation required     |

### Public Routes

| Method | Path                | Behavior                                                                                                             |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/setup`            | Shows owner setup only while no workspace exists; otherwise redirects to `/sign-in` or `/dashboard`                  |
| GET    | `/sign-in`          | Email/password sign-in and recovery link                                                                             |
| GET    | `/forgot-password`  | Non-enumerating recovery request form                                                                                |
| GET    | `/reset-password`   | Password update form for a valid Supabase recovery session                                                           |
| GET    | `/invite/[token]`   | Shows invite details and account form only for a valid unresolved token; otherwise an explicit expired/invalid state |
| GET    | `/auth/confirm`     | Exchanges Supabase email/recovery codes and redirects only to allow-listed local destinations                        |
| GET    | `/dashboard`        | Authenticated active members only                                                                                    |
| GET    | `/settings/members` | Authenticated active members; owner-only controls are hidden from members and re-authorized by actions               |

### Data Models

- Invitation tokens are at least 32 random bytes, URL-safe, and only a SHA-256 hash is stored. `accepted_at` and `revoked_at` are mutually exclusive; expiry is checked server-side and in the transactional accept function.
- A singleton workspace has exactly one active owner. Setup and invitation acceptance use narrow, service-role-only `security definer` functions with fixed `search_path`, revoked PUBLIC execution, and explicit user IDs/emails verified against Supabase Auth before any profile or membership is written.
- Membership departure sets the membership inactive before cleanup. Personal categories, rules, budgets, manual entries, account metadata and member-owned Personal financial records are deleted; member-linked Plaid Items are marked revoked/archived and their secrets remain server-only; Family-scoped history is preserved.
- Session refresh uses Supabase SSR cookies. An absolute session start timestamp limits a login to 30 days even if refresh tokens remain valid. Recent password confirmation lasts 15 minutes and is required for membership removal, ownership transfer, account/data deletion, and workspace deletion.

### UI Components

- `AuthShell`: editorial household-ledger layout matching existing mineral/green tokens and typography.
- `AuthForm`: labelled inputs, field errors, pending state, status region; `data-testid="auth-form"`.
- Setup submit: `data-testid="setup-submit"`.
- Sign-in submit: `data-testid="sign-in-submit"`.
- Recovery submit: `data-testid="recovery-submit"`.
- Reset submit: `data-testid="reset-submit"`.
- Invite status: `data-testid="invite-status"`; accept submit: `data-testid="invite-accept-submit"`.
- Invitation list: `data-testid="invitation-list"`; create form: `data-testid="invitation-create-form"`; invite URL: `data-testid="invite-url"`.
- Membership list: `data-testid="membership-list"`; recent-password dialog/form: `data-testid="password-confirmation"`.
- Destructive actions use explicit labels, visible consequences, keyboard focus, reduced-motion support, and accessible live feedback.

## Database / API Acceptance Tests

| ID      | Scenario                                                      | Expected result                                                                                                       |
| ------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| API-001 | Two callers race first setup                                  | Exactly one singleton workspace and active owner are created; loser receives setup-closed error                       |
| API-002 | Setup is attempted after a workspace exists                   | Backend rejects it even if UI is bypassed                                                                             |
| API-003 | Owner creates then revokes an invitation                      | Only hash is stored; revoked token cannot be accepted                                                                 |
| API-004 | Invitation is accepted once by matching email                 | Profile and active membership are created and `accepted_at` is set atomically                                         |
| API-005 | Invitation is expired, replayed, or used by a different email | Generic rejection and no account/membership side effects                                                              |
| API-006 | Member or anonymous caller manages invitations                | Database/server authorization rejects the request                                                                     |
| API-007 | Owner transfers ownership to an active member                 | Workspace owner and both roles change atomically; exactly one active owner remains                                    |
| API-008 | Sole owner attempts to leave/delete their account             | Rejected until ownership is transferred                                                                               |
| API-009 | Member leaves or owner removes member                         | Membership becomes inactive, access ceases, Personal data is deleted, Plaid Items are revoked, Family history remains |
| API-010 | Destructive action lacks recent confirmation                  | Rejected even for an otherwise authorized caller                                                                      |
| API-011 | Authenticated session exceeds 30 days                         | Session is signed out and protected routes redirect to sign-in                                                        |
| API-012 | Recovery is requested for existing and absent email           | Same client-visible response is returned                                                                              |

## Frontend Acceptance Tests

| ID     | User action                                               | Expected result                                                                                                    |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| FE-001 | First visitor opens setup and submits valid owner details | Setup form is usable and successful setup reaches the protected dashboard                                          |
| FE-002 | Visitor opens sign-in, forgot-password, and reset flows   | Each flow has accessible labels, pending/error feedback, and no account enumeration                                |
| FE-003 | Invitee opens valid, expired, revoked, and replayed links | Valid invite permits joining; invalid variants show a clear terminal state without exposing stored token data      |
| FE-004 | Owner manages invitations and members                     | Owner can create/copy/revoke links and sees guarded membership operations                                          |
| FE-005 | Member opens membership settings                          | Member can leave but cannot see or invoke owner-only controls                                                      |
| FE-006 | Anonymous user requests `/dashboard`                      | Redirected to `/sign-in` with a safe local return path                                                             |
| FE-007 | Desktop and mobile auth pages render                      | No horizontal overflow; clear focus states and screenshots captured at setup, sign-in, invite, and member settings |

## Test Status

- [x] API-001 through API-010: PASS — 191-assertion pgTAP lifecycle/security suite
- [x] API-012: PASS — validation/non-enumeration unit and browser coverage
- [ ] API-011: Authored; live expired-session cookie fixture required
- [ ] FE-001: Authored; isolated empty Supabase fixture required
- [x] FE-002: PASS — desktop and mobile Chromium
- [ ] FE-003 through FE-005: Authored; live invitation/owner/member fixtures required
- [x] FE-006 and FE-007: PASS — desktop and mobile Chromium with screenshots
