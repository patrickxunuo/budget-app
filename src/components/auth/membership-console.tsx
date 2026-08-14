"use client";

import { useActionState, useState } from "react";
import {
  confirmPassword,
  createInvitation,
  deleteAccount,
  deleteWorkspace,
  leaveWorkspace,
  removeMember,
  revokeInvitation,
  transferOwnership,
} from "@/lib/auth/actions";
import { idleAuthState, type AuthActionState } from "@/lib/auth/types";
import { Field } from "./auth-form";

type Member = {
  id: string;
  profile_id: string;
  role: string;
  display_name: string;
};
type Invite = { id: string; email: string; expires_at: string };
/**
 * `testId` is required rather than optional on purpose. The console renders one
 * of these per action, so several can be live at once, and `role="status"` alone
 * is then ambiguous — a browser assertion scoped only to `<main>` matches every
 * open feedback region plus the `<output>` holding the invite URL, which carries
 * an implicit `status` role of its own. Naming each region is what lets a spec
 * assert on the one action it just performed.
 */
function Feedback({
  state,
  testId,
}: {
  state: AuthActionState;
  testId: string;
}) {
  if (state.status === "idle") return null;
  return (
    <p
      data-testid={testId}
      role="status"
      aria-live="polite"
      className={
        state.status === "error" ? "text-alert text-sm" : "text-brand text-sm"
      }
    >
      {state.message}
    </p>
  );
}

function InlineAction({
  formAction,
  fields,
  label,
  pendingLabel,
  pending,
  danger = false,
}: Readonly<{
  formAction: (payload: FormData) => void;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  pending: boolean;
  danger?: boolean;
}>) {
  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        disabled={pending}
        className={
          danger
            ? "border-alert/40 text-alert rounded-lg border px-3 py-2 text-xs font-semibold"
            : "border-line hover:border-brand rounded-lg border px-3 py-2 text-xs font-semibold"
        }
      >
        {pending ? pendingLabel : label}
      </button>
    </form>
  );
}
function CopyInviteButton({ inviteUrl }: { inviteUrl: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage("Invite link copied.");
    } catch {
      setMessage("Could not copy automatically. Select and copy the link.");
    }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="border-brand text-brand rounded-lg border px-3 py-2 text-xs font-semibold"
      >
        Copy invite link
      </button>
      <span role="status" aria-live="polite" className="text-muted text-xs">
        {message}
      </span>
    </div>
  );
}

export function MembershipConsole({
  isOwner,
  members,
  invitations,
  workspaceName,
}: Readonly<{
  isOwner: boolean;
  members: Member[];
  invitations: Invite[];
  workspaceName: string;
}>) {
  const [inviteState, inviteAction, invitePending] = useActionState(
    createInvitation,
    idleAuthState,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmPassword,
    idleAuthState,
  );
  const [leaveState, leaveAction, leavePending] = useActionState(
    leaveWorkspace,
    idleAuthState,
  );
  const [accountState, accountAction, accountPending] = useActionState(
    deleteAccount,
    idleAuthState,
  );
  const [workspaceState, workspaceAction, workspacePending] = useActionState(
    deleteWorkspace,
    idleAuthState,
  );
  const [transferState, transferAction, transferPending] = useActionState(
    transferOwnership,
    idleAuthState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeMember,
    idleAuthState,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeInvitation,
    idleAuthState,
  );
  const [accountConfirmation, setAccountConfirmation] = useState("");
  const [workspaceConfirmation, setWorkspaceConfirmation] = useState("");
  const [workspaceAcknowledged, setWorkspaceAcknowledged] = useState(false);
  const createdInviteUrl =
    typeof inviteState.data?.inviteUrl === "string"
      ? inviteState.data.inviteUrl
      : null;

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-utility text-brand text-[.65rem] tracking-[.14em] uppercase">
              Active household
            </p>
            <h2 className="font-display text-ink mt-2 text-3xl font-semibold tracking-[-.04em]">
              People with a key
            </h2>
          </div>
          <span className="font-utility text-muted text-xs">
            {members.length.toString().padStart(2, "0")}
          </span>
        </div>
        <ul
          data-testid="membership-list"
          className="border-line mt-5 divide-y rounded-2xl border"
        >
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-ink font-semibold">{member.display_name}</p>
                <p className="font-utility text-muted mt-1 text-[.65rem] tracking-[.1em] uppercase">
                  {member.role}
                </p>
              </div>
              {isOwner && member.role !== "owner" && (
                <div className="flex flex-wrap gap-3">
                  <InlineAction
                    formAction={transferAction}
                    fields={{ membershipId: member.id }}
                    label="Transfer ownership"
                    pendingLabel="Transferring…"
                    pending={transferPending}
                  />
                  <InlineAction
                    formAction={removeAction}
                    fields={{ membershipId: member.id }}
                    label="Remove member"
                    pendingLabel="Removing…"
                    pending={removePending}
                    danger
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
        <Feedback state={transferState} testId="ownership-transfer-feedback" />
        <Feedback state={removeState} testId="member-removal-feedback" />
      </section>

      {isOwner && (
        <section className="border-line bg-panel rounded-2xl border p-5 sm:p-6">
          <h2 className="font-display text-ink text-2xl font-semibold">
            Invite a family member
          </h2>
          <form
            action={inviteAction}
            data-testid="invitation-create-form"
            className="mt-5 grid gap-4 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
          >
            <Field label="Email" name="email" type="email" />
            <label className="text-ink text-sm font-semibold">
              Expires in
              <select
                name="expiresInHours"
                defaultValue="72"
                className="border-line bg-surface mt-2 min-h-12 w-full rounded-xl border px-3"
              >
                <option value="24">1 day</option>
                <option value="72">3 days</option>
                <option value="168">7 days</option>
              </select>
            </label>
            <button
              disabled={invitePending}
              className="bg-brand text-on-accent min-h-12 rounded-xl px-5 text-sm font-semibold"
            >
              {invitePending ? "Creating…" : "Create link"}
            </button>
          </form>
          <Feedback state={inviteState} testId="invitation-feedback" />
          {createdInviteUrl && (
            <div>
              <output
                data-testid="invite-url"
                className="border-brand/25 bg-surface text-ink mt-4 block rounded-xl border p-4 text-sm break-all"
              >
                {createdInviteUrl}
              </output>
              <CopyInviteButton inviteUrl={createdInviteUrl} />
            </div>
          )}
          <ul data-testid="invitation-list" className="mt-6 space-y-2">
            {invitations.map((invite) => (
              <li
                key={invite.id}
                className="bg-surface flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold">{invite.email}</p>
                  <p className="text-muted text-xs">
                    Expires {new Date(invite.expires_at).toLocaleString()}
                  </p>
                </div>
                <InlineAction
                  formAction={revokeAction}
                  fields={{ invitationId: invite.id }}
                  label="Revoke link"
                  pendingLabel="Revoking…"
                  pending={revokePending}
                  danger
                />
              </li>
            ))}
          </ul>
          <Feedback
            state={revokeState}
            testId="invitation-revocation-feedback"
          />
        </section>
      )}

      <section
        data-testid="password-confirmation"
        className="border-mineral/30 bg-mineral/5 rounded-2xl border p-5 sm:p-6"
      >
        <h2 className="font-display text-ink text-2xl font-semibold">
          Confirm before changing the household
        </h2>
        <p className="text-muted mt-2 text-sm leading-6">
          A password confirmation opens a 15-minute window for the guarded
          actions below.
        </p>
        <form
          action={confirmAction}
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Field
              label="Current password"
              name="password"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <button
            disabled={confirmPending}
            className="bg-mineral text-on-accent min-h-12 rounded-xl px-5 text-sm font-semibold"
          >
            {confirmPending ? "Checking…" : "Confirm password"}
          </button>
        </form>
        <Feedback
          state={confirmState}
          testId="password-confirmation-feedback"
        />
      </section>

      <section
        data-testid="data-lifecycle-danger-zone"
        className="border-alert/30 rounded-2xl border p-5 sm:p-6"
      >
        <p className="font-utility text-alert text-[.65rem] font-semibold tracking-[.14em] uppercase">
          Consequences are permanent
        </p>
        <h2 className="font-display text-ink mt-2 text-3xl font-semibold">
          Departure ledger
        </h2>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="text-muted mb-3 text-sm">
              Leave this workspace and remove your Personal records. Family
              history remains.
            </p>
            <form action={leaveAction}>
              <button
                disabled={leavePending}
                className="border-alert text-alert min-h-11 rounded-xl border px-4 text-sm font-semibold"
              >
                {leavePending ? "Leaving…" : "Leave workspace"}
              </button>
            </form>
            <Feedback state={leaveState} testId="leave-workspace-feedback" />
          </div>
          <div>
            <p className="text-muted mb-3 text-sm">
              Delete your account after safely leaving. Owners must transfer
              first.
            </p>
            <form action={accountAction} className="space-y-3">
              <p className="text-muted text-xs leading-5">
                Plaid connections are revoked first. If confirmation fails,
                encrypted credentials and records stay intact for a safe retry.
              </p>
              <label className="text-ink block text-sm font-semibold">
                Type DELETE MY ACCOUNT
                <input
                  data-testid="account-deletion-confirmation"
                  name="accountConfirmation"
                  autoComplete="off"
                  value={accountConfirmation}
                  onChange={(event) =>
                    setAccountConfirmation(event.target.value)
                  }
                  className="border-line bg-surface mt-2 min-h-11 w-full rounded-xl border px-3"
                />
              </label>
              <button
                data-testid="delete-account"
                disabled={
                  accountPending || accountConfirmation !== "DELETE MY ACCOUNT"
                }
                className="bg-alert text-on-accent min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
              >
                {accountPending ? "Revoking banks…" : "Delete my account"}
              </button>
            </form>{" "}
            <Feedback state={accountState} testId="account-deletion-feedback" />
          </div>
          {isOwner && (
            <div className="lg:col-span-2">
              <form
                action={workspaceAction}
                className="border-alert/20 mt-2 space-y-4 border-t pt-5"
              >
                <p className="text-muted text-sm leading-6">
                  Active members receive an email notification when SMTP is
                  configured, then every Plaid Item is revoked before local data
                  is purged. Failures leave everything retryable. Deletion is
                  irreversible; full backup and restore remains the Supabase
                  administrator’s responsibility.
                </p>
                <label className="text-ink block text-sm font-semibold">
                  {`Type “${workspaceName}” to delete the entire workspace`}
                  <input
                    name="workspaceName"
                    value={workspaceConfirmation}
                    onChange={(event) =>
                      setWorkspaceConfirmation(event.target.value)
                    }
                    className="border-line bg-surface mt-2 min-h-11 w-full rounded-xl border px-3"
                  />
                </label>
                <label className="text-ink flex items-start gap-3 text-sm font-semibold">
                  <input
                    data-testid="workspace-deletion-acknowledgement"
                    type="checkbox"
                    name="irreversibleAcknowledgement"
                    checked={workspaceAcknowledged}
                    onChange={(event) =>
                      setWorkspaceAcknowledged(event.target.checked)
                    }
                    className="accent-alert mt-1 size-4"
                  />
                  I understand this permanently deletes the complete workspace
                  and every member’s Personal records.
                </label>
                <button
                  data-testid="delete-workspace"
                  disabled={
                    workspacePending ||
                    workspaceConfirmation.trim() !== workspaceName.trim() ||
                    !workspaceAcknowledged
                  }
                  className="bg-alert text-on-accent min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-60"
                >
                  {workspacePending
                    ? "Warning members and revoking banks…"
                    : "Delete family workspace"}
                </button>
              </form>{" "}
              <Feedback
                state={workspaceState}
                testId="workspace-deletion-feedback"
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
