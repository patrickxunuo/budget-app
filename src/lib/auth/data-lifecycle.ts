import "server-only";

import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env/server";
import { revokePlaidItemsForDeletion } from "@/lib/plaid/service";

export type DeletionResult =
  | { ok: true }
  | { ok: false; message: string; unresolvedPlaidItemIds: string[] };

const failure = (
  message: string,
  unresolvedPlaidItemIds: string[] = [],
): DeletionResult => ({ ok: false, message, unresolvedPlaidItemIds });

async function actor() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createSupabaseAdminClient();
  const { data: membership } = await admin
    .from("workspace_memberships")
    .select("workspace_id,profile_id,role,workspaces(name)")
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const { data: recent } = await admin
    .from("recent_auth_confirmations")
    .select("confirmed_at")
    .eq("profile_id", user.id)
    .gt("confirmed_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .maybeSingle();
  return membership && recent ? { user, membership, supabase, admin } : null;
}

export async function deleteAccountData(): Promise<DeletionResult> {
  const context = await actor();
  if (!context) return failure("Confirm your password before continuing.");
  if (context.membership.role === "owner")
    return failure("Transfer ownership or delete the workspace first.");
  let revoked;
  try {
    revoked = await revokePlaidItemsForDeletion(
      context.membership.workspace_id,
      context.user.id,
    );
  } catch {
    return failure(
      "Bank connections could not be verified. Nothing was deleted; retry when the provider is available.",
    );
  }
  if (revoked.unresolvedItemIds.length)
    return failure(
      "Some bank connections could not be confirmed as revoked. Nothing was deleted; retry when the provider is available.",
      revoked.unresolvedItemIds,
    );
  const { error } = await context.supabase.rpc("finalize_account_deletion");
  if (error)
    return failure(
      error.message.includes("recent")
        ? "Confirm your password before continuing."
        : "Account deletion could not be finalized safely.",
    );
  return { ok: true };
}

async function notifyWorkspaceMembers(
  workspaceId: string,
  workspaceName: string,
  profileIds: string[],
) {
  const env = getServerEnv();
  if (!env.SMTP_URL || !env.SMTP_FROM) return;
  const admin = createSupabaseAdminClient();
  const recipients = new Map<string, string>();
  const remaining = new Set(profileIds);
  for (let page = 1; remaining.size; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Auth recipient lookup failed");
    for (const user of result.data.users) {
      if (remaining.has(user.id) && user.email) {
        recipients.set(user.id, user.email);
        remaining.delete(user.id);
      }
    }
    if (result.data.users.length < 1000) break;
  }
  if (remaining.size) throw new Error("Active member email unavailable");
  const transport = nodemailer.createTransport(env.SMTP_URL);
  for (const profileId of profileIds) {
    const claimId = randomUUID();
    const { data: claim, error: claimError } = await admin.rpc(
      "claim_workspace_deletion_notification",
      {
        p_workspace_id: workspaceId,
        p_profile_id: profileId,
        p_claim_id: claimId,
      },
    );
    if (claimError || claim === "busy")
      throw new Error("Notification is already in progress");
    if (claim === "sent") continue;
    try {
      await transport.sendMail({
        from: env.SMTP_FROM,
        to: recipients.get(profileId)!,
        messageId: `<workspace-delete.${workspaceId}.${profileId}@budget-app.local>`,
        subject: `${workspaceName} will be permanently deleted`,
        text: `The owner requested permanent deletion of ${workspaceName}. Connected banks have been revoked. Export anything you need now; database backup and restore are the Supabase administrator's responsibility.`,
      });
    } catch {
      await admin.rpc("release_workspace_deletion_notification", {
        p_workspace_id: workspaceId,
        p_profile_id: profileId,
        p_claim_id: claimId,
      });
      throw new Error("Notification delivery failed");
    }
    const { error: markError } = await admin.rpc(
      "mark_workspace_deletion_notification_sent",
      {
        p_workspace_id: workspaceId,
        p_profile_id: profileId,
        p_claim_id: claimId,
      },
    );
    // Delivery succeeded. Do not release an ambiguous ledger failure: the stale
    // claim is safely adoptable and the deterministic Message-ID identifies it.
    if (markError) throw new Error("Notification confirmation failed");
  }
}

export async function deleteWorkspaceData(input: {
  workspaceName: string;
}): Promise<DeletionResult> {
  const context = await actor();
  if (!context || context.membership.role !== "owner")
    return failure(
      "Only the owner with a recent password confirmation can delete this workspace.",
    );
  const workspace = Array.isArray(context.membership.workspaces)
    ? context.membership.workspaces[0]
    : context.membership.workspaces;
  if (!workspace || workspace.name !== input.workspaceName.trim())
    return failure("Enter the workspace name exactly as shown.");
  const { data: members, error: membersError } = await context.admin
    .from("workspace_memberships")
    .select("profile_id")
    .eq("workspace_id", context.membership.workspace_id)
    .eq("status", "active");
  if (membersError) return failure("Workspace members could not be verified.");
  let revoked;
  try {
    revoked = await revokePlaidItemsForDeletion(
      context.membership.workspace_id,
    );
  } catch {
    return failure(
      "Bank connections could not be verified. Nothing was deleted; retry when the provider is available.",
    );
  }
  if (revoked.unresolvedItemIds.length)
    return failure(
      "Some bank connections could not be confirmed as revoked. Nothing was deleted; retry when the provider is available.",
      revoked.unresolvedItemIds,
    );
  const env = getServerEnv();
  const notificationsRequired = Boolean(env.SMTP_URL && env.SMTP_FROM);
  try {
    await notifyWorkspaceMembers(
      context.membership.workspace_id,
      workspace.name,
      (members ?? []).map((member) => member.profile_id),
    );
  } catch {
    return failure(
      "Member notifications could not be delivered. Nothing was deleted; retry after checking SMTP configuration.",
    );
  }
  const { error } = await context.admin.rpc("finalize_workspace_deletion", {
    p_actor_id: context.user.id,
    p_workspace_name: input.workspaceName.trim(),
    p_notifications_required: notificationsRequired,
  });
  if (error)
    return failure(
      "Workspace deletion could not be finalized safely. Membership may have changed; retry to notify every active member.",
    );
  return { ok: true };
}
