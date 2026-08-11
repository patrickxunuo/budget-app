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
function Feedback({ state }: { state: AuthActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
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
        <Feedback state={transferState} />
        <Feedback state={removeState} />
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
              className="bg-brand min-h-12 rounded-xl px-5 text-sm font-semibold text-white"
            >
              {invitePending ? "Creating…" : "Create link"}
            </button>
          </form>
          <Feedback state={inviteState} />
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
          <Feedback state={revokeState} />
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
            className="bg-mineral min-h-12 rounded-xl px-5 text-sm font-semibold text-white"
          >
            {confirmPending ? "Checking…" : "Confirm password"}
          </button>
        </form>
        <Feedback state={confirmState} />
      </section>

      <section className="border-alert/30 rounded-2xl border p-5 sm:p-6">
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
            <Feedback state={leaveState} />
          </div>
          <div>
            <p className="text-muted mb-3 text-sm">
              Delete your account after safely leaving. Owners must transfer
              first.
            </p>
            <form action={accountAction}>
              <button
                disabled={accountPending}
                className="bg-alert min-h-11 rounded-xl px-4 text-sm font-semibold text-white"
              >
                {accountPending ? "Deleting…" : "Delete my account"}
              </button>
            </form>
            <Feedback state={accountState} />
          </div>
          {isOwner && (
            <div className="lg:col-span-2">
              <form
                action={workspaceAction}
                className="border-alert/20 mt-2 border-t pt-5"
              >
                <Field
                  label={`Type “${workspaceName}” to delete the entire workspace`}
                  name="workspaceName"
                />
                <button
                  disabled={workspacePending}
                  className="bg-alert mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-white"
                >
                  {workspacePending ? "Deleting…" : "Delete family workspace"}
                </button>
              </form>
              <Feedback state={workspaceState} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
