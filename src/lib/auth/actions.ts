"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env/server";
import { revokeDepartingMemberPlaidItems } from "@/lib/plaid/service";
import { deleteAccountData, deleteWorkspaceData } from "./data-lifecycle";
import { deleteQueuedAuthUser, enqueueAuthDeletion } from "./deletion-queue";
import {
  clearApplicationAuthCookies,
  createRecoveryCallbackState,
  consumeRecoveryFlow,
  establishSessionStart,
  markRecentConfirmationCookie,
} from "./session-state";
import type { AuthActionState } from "./types";
import {
  acceptInvitationSchema,
  confirmationPasswordSchema,
  createInvitationSchema,
  deleteAccountSchema,
  deleteWorkspaceSchema,
  formValues,
  membershipSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  setupFamilySchema,
  signInSchema,
} from "./validation";

const genericAuthError =
  "We could not complete that request. Check the details and try again.";
const cleanupFailure =
  "We could not safely finish account setup. Contact the site administrator before retrying.";
const genericInviteError =
  "This invitation is invalid, expired, or has already been used.";

function invalid(error: {
  flatten(): { fieldErrors: Record<string, string[]> };
}): AuthActionState {
  return {
    status: "error",
    fieldErrors: error.flatten().fieldErrors,
    message: "Review the highlighted fields.",
  };
}
function safeNext(value?: string) {
  return value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : "/dashboard";
}
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
async function rpcError(
  error: unknown,
  message = genericAuthError,
): Promise<AuthActionState> {
  console.error("Authentication operation failed", error);
  return { status: "error", message };
}

async function compensateCreatedUser(userId: string) {
  const supabase = await createSupabaseServerClient();
  const signOutResult = await supabase.auth.signOut();
  await clearApplicationAuthCookies();
  if (signOutResult.error)
    console.error("Compensation sign-out failed", signOutResult.error);
  if (!(await enqueueAuthDeletion(userId, "orphaned_auth_identity")))
    return false;
  return deleteQueuedAuthUser(userId);
}

async function recordConfirmation(userId: string) {
  const { error } = await createSupabaseAdminClient().rpc(
    "mark_recent_password_confirmation",
    { p_profile_id: userId },
  );
  if (error) return rpcError(error);
  await markRecentConfirmationCookie(userId);
  return null;
}

export async function setupFamily(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = setupFamilySchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const admin = createSupabaseAdminClient();
  const created = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    return { status: "error", message: genericAuthError };

  const supabase = await createSupabaseServerClient();
  const session = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (session.error || !session.data.user) {
    const cleaned = await compensateCreatedUser(created.data.user.id);
    return {
      status: "error",
      message: cleaned ? genericAuthError : cleanupFailure,
    };
  }
  const result = await admin.rpc("setup_family", {
    p_user_id: created.data.user.id,
    p_email: parsed.data.email,
    p_display_name: parsed.data.displayName,
    p_workspace_name: parsed.data.workspaceName,
  });
  if (result.error) {
    const cleaned = await compensateCreatedUser(created.data.user.id);
    if (!cleaned) return { status: "error", message: cleanupFailure };
    return rpcError(
      result.error,
      result.error.message.includes("setup closed")
        ? "Family setup is already complete."
        : genericAuthError,
    );
  }
  await establishSessionStart(session.data.user.id);
  redirect("/dashboard");
}

export async function signIn(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user)
    return { status: "error", message: "Email or password is incorrect." };
  const membership = await supabase
    .from("workspace_memberships")
    .select("id")
    .eq("profile_id", data.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership.data) {
    await supabase.auth.signOut();
    await clearApplicationAuthCookies();
    return { status: "error", message: "Email or password is incorrect." };
  }
  await establishSessionStart(data.user.id);
  redirect(safeNext(parsed.data.next));
}

export async function signOut(): Promise<AuthActionState> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "global" });
  await clearApplicationAuthCookies();
  if (error) return rpcError(error, "Could not sign out. Please try again.");
  redirect("/sign-in");
}

export async function requestPasswordReset(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = requestPasswordResetSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const env = getServerEnv();
  const supabase = await createSupabaseServerClient();
  const recoveryState = createRecoveryCallbackState(parsed.data.email);
  const callback = new URL("/auth/confirm", env.APP_URL);
  callback.searchParams.set("type", "recovery");
  callback.searchParams.set("next", "/reset-password");
  callback.searchParams.set("state", recoveryState);
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callback.toString(),
  });
  return {
    status: "success",
    message:
      "If that address belongs to this family, a recovery link is on its way.",
  };
}

export async function resetPassword(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await consumeRecoveryFlow(user.id)))
    return {
      status: "error",
      message: "This recovery session is invalid or expired.",
    };
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error)
    return {
      status: "error",
      message: "This recovery session is invalid or expired.",
    };
  const confirmationError = await recordConfirmation(user.id);
  if (confirmationError) return confirmationError;
  await establishSessionStart(user.id);
  redirect("/dashboard");
}

export async function createInvitation(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = createInvitationSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + parsed.data.expiresInHours * 3600000,
  ).toISOString();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_email: parsed.data.email,
    p_token_hash: hashToken(token),
    p_expires_at: expiresAt,
  });
  if (error)
    return rpcError(
      error,
      error.code === "23505"
        ? "An active invitation already exists for this address."
        : genericAuthError,
    );
  const row = Array.isArray(data) ? data[0] : data;
  revalidatePath("/settings/members");
  return {
    status: "success",
    message: "Invitation ready to share.",
    data: {
      invitationId: row?.invitation_id,
      inviteUrl: `${getServerEnv().APP_URL}/invite/${token}`,
      expiresAt: row?.expires_at ?? expiresAt,
    },
  };
}

export async function revokeInvitation(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = membershipSchema
    .pick({ membershipId: true })
    .safeParse({ membershipId: formData.get("invitationId") });
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_invitation", {
    p_invitation_id: parsed.data.membershipId,
  });
  if (error) return rpcError(error);
  revalidatePath("/settings/members");
  return { status: "success", message: "Invitation revoked." };
}

export async function acceptInvitation(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = acceptInvitationSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const tokenHash = hashToken(parsed.data.token);
  const admin = createSupabaseAdminClient();
  const { data: invite } = await admin
    .from("invitations")
    .select("email")
    .eq("token_hash", tokenHash)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!invite) return { status: "error", message: genericInviteError };
  const created = await admin.auth.admin.createUser({
    email: invite.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    return { status: "error", message: genericInviteError };

  const supabase = await createSupabaseServerClient();
  const session = await supabase.auth.signInWithPassword({
    email: invite.email,
    password: parsed.data.password,
  });
  if (session.error || !session.data.user) {
    const cleaned = await compensateCreatedUser(created.data.user.id);
    return {
      status: "error",
      message: cleaned ? genericInviteError : cleanupFailure,
    };
  }
  const accepted = await admin.rpc("accept_invitation", {
    p_user_id: created.data.user.id,
    p_email: invite.email,
    p_token_hash: tokenHash,
    p_display_name: parsed.data.displayName,
  });
  if (accepted.error) {
    const cleaned = await compensateCreatedUser(created.data.user.id);
    if (!cleaned) return { status: "error", message: cleanupFailure };
    return rpcError(accepted.error, genericInviteError);
  }
  await establishSessionStart(session.data.user.id);
  redirect("/dashboard");
}

export async function confirmPassword(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = confirmationPasswordSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email)
    return {
      status: "error",
      message: "Your session has expired. Sign in again.",
    };
  const verified = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.password,
  });
  if (verified.error || verified.data.user?.id !== user.id)
    return { status: "error", message: "Password confirmation failed." };
  const confirmationError = await recordConfirmation(user.id);
  if (confirmationError) return confirmationError;
  return { status: "success", message: "Password confirmed for 15 minutes." };
}

async function membershipMutation(
  name: "leave_workspace" | "remove_member" | "transfer_ownership",
  args?: Record<string, string>,
): Promise<AuthActionState> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(name, args);
  if (error)
    return rpcError(
      error,
      error.message.includes("recent")
        ? "Confirm your password before continuing."
        : genericAuthError,
    );
  revalidatePath("/settings/members");
  return { status: "success", message: "Household membership updated." };
}

async function preparePlaidDeparture(
  targetMembershipId?: string,
): Promise<{ error: string | null }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: genericAuthError };

  const admin = createSupabaseAdminClient();
  const { data: confirmation, error: confirmationError } = await admin
    .from("recent_auth_confirmations")
    .select("confirmed_at")
    .eq("profile_id", user.id)
    .gt("confirmed_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .maybeSingle();
  if (confirmationError) return { error: genericAuthError };
  if (!confirmation)
    return { error: "Confirm your password before continuing." };

  const { data: actor, error: actorError } = await admin
    .from("workspace_memberships")
    .select("workspace_id,profile_id,role")
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (actorError || !actor) return { error: genericAuthError };

  let departingProfileId = actor.profile_id as string;
  if (targetMembershipId) {
    if (actor.role !== "owner") return { error: genericAuthError };
    const { data: target, error: targetError } = await admin
      .from("workspace_memberships")
      .select("profile_id")
      .eq("id", targetMembershipId)
      .eq("workspace_id", actor.workspace_id)
      .eq("role", "member")
      .eq("status", "active")
      .maybeSingle();
    if (targetError || !target) return { error: genericAuthError };
    departingProfileId = target.profile_id as string;
  }

  try {
    await revokeDepartingMemberPlaidItems(
      actor.workspace_id as string,
      departingProfileId,
    );
  } catch (error) {
    console.error("Plaid departure revocation failed", error);
    return {
      error:
        "The member's bank connections could not be secured. Try again before changing membership.",
    };
  }
  return { error: null };
}

export async function leaveWorkspace(
  state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  void state;
  void formData;
  const prepared = await preparePlaidDeparture();
  if (prepared.error) return { status: "error", message: prepared.error };
  return membershipMutation("leave_workspace");
}
export async function removeMember(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = membershipSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const prepared = await preparePlaidDeparture(parsed.data.membershipId);
  if (prepared.error) return { status: "error", message: prepared.error };
  return membershipMutation("remove_member", {
    p_membership_id: parsed.data.membershipId,
  });
}
export async function transferOwnership(
  _state: AuthActionState,
  formData: FormData,
) {
  const parsed = membershipSchema.safeParse(formValues(formData));
  return parsed.success
    ? membershipMutation("transfer_ownership", {
        p_membership_id: parsed.data.membershipId,
      })
    : invalid(parsed.error);
}

export async function deleteAccount(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = deleteAccountSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await deleteAccountData();
  if (!result.ok)
    return {
      status: "error",
      message: result.message,
      data: { unresolvedPlaidItemIds: result.unresolvedPlaidItemIds },
    };
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "global" });
  await clearApplicationAuthCookies();
  redirect("/sign-in");
}

export async function deleteWorkspace(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = deleteWorkspaceSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await deleteWorkspaceData({
    workspaceName: parsed.data.workspaceName,
  });
  if (!result.ok)
    return {
      status: "error",
      message: result.message,
      data: { unresolvedPlaidItemIds: result.unresolvedPlaidItemIds },
    };
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "global" });
  await clearApplicationAuthCookies();
  redirect("/setup");
}
