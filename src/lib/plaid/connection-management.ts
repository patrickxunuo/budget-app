import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { PlaidApiActor } from "@/lib/auth/api";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptAccessToken, parseBytea } from "./crypto";
import { PlaidFlowError } from "./errors";
import { getPlaidProvider } from "./provider";
import { oauthRedirectUri } from "./service";
import { reviewEligibility, toAccountKind } from "./account-review";
import type {
  ManagedPlaidAccount,
  PlaidConnection,
  PlaidDisconnectMode,
  PlaidUpdateReason,
  ProviderAccount,
} from "./types";

const visibilitySchema = z.object({
  accountId: z.string().uuid(),
  scope: z.enum(["personal", "family"]),
  acknowledgeRetroactiveImpact: z.literal(true),
});
const updateSchema = z.object({
  reason: z.enum([
    "login_repair",
    "consent",
    "permissions",
    "account_selection",
  ]),
});
const reconcileSchema = z.object({
  deleteDeselectedAccountIds: z.array(z.string().uuid()).max(100).optional(),
});
const disconnectSchema = z.object({
  mode: z.enum(["keep_history", "delete_data"]),
});

type ItemRow = {
  id: string;
  workspace_id: string;
  linked_by: string;
  institution_name: string;
  access_token_ciphertext: string | Uint8Array;
  status: "pending" | "active" | "error" | "revoked";
  archived_at: string | null;
  disconnected_at: string | null;
};
type AccountRow = {
  id: string;
  provider_account_id: string;
  display_name: string | null;
  name: string;
  mask: string | null;
  subtype: "chequing" | "savings" | "credit_card";
  scope: "personal" | "family";
  owner_profile_id: string | null;
  available_balance_cents: number | null;
  current_balance_cents: number | null;
  balance_updated_at: string | null;
  archived_at: string | null;
  lifecycle: "live" | "deselected" | "disconnected";
  read_only: boolean;
};
type SyncRow = {
  last_success_at: string | null;
  consent_expires_at: string | null;
  needs_login_repair: boolean;
  status: string;
};

class PlaidManagementError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 502,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function failure(
  status: 400 | 403 | 404 | 409 | 502,
  code: string,
  message: string,
) {
  return status === 404
    ? new PlaidManagementError(status, code, message)
    : new PlaidFlowError(status, code, message);
}
function databaseFailure() {
  return failure(
    502,
    "connection_management_failed",
    "The bank connection could not be updated. Please try again.",
  );
}
function providerFailure() {
  return failure(
    502,
    "plaid_update_failed",
    "Plaid could not update this connection. Please try again.",
  );
}
function parseRpcError(error: { message?: string; code?: string } | null) {
  const message = error?.message ?? "";
  if (message.includes("acknowledgement"))
    return failure(
      400,
      "retroactive_acknowledgement_required",
      "Acknowledge the retroactive privacy impact before changing visibility.",
    );
  if (message.includes("deselected"))
    return failure(
      400,
      "invalid_deselected_account",
      "Only deselected accounts on this connection can be deleted.",
    );
  if (message.includes("forbidden") || error?.code === "42501")
    return failure(
      403,
      "forbidden",
      "Only the member who linked this bank can manage it.",
    );
  if (message.includes("disconnected") || error?.code === "55000")
    return failure(
      409,
      "connection_unavailable",
      "This bank connection is no longer active.",
    );
  if (error?.code === "P0002")
    return failure(
      404,
      "not_found",
      "That bank connection or account was not found.",
    );
  return databaseFailure();
}
async function loadOwnedItem(
  actor: PlaidApiActor,
  itemId: string,
  allowDisconnected = false,
): Promise<ItemRow> {
  const admin = createSupabaseAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", actor.workspaceId)
    .eq("profile_id", actor.userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw databaseFailure();
  if (!membership)
    throw failure(403, "forbidden", "An active membership is required.");
  const { data, error } = await admin
    .from("plaid_items")
    .select(
      "id,workspace_id,linked_by,institution_name,access_token_ciphertext,status,archived_at,disconnected_at",
    )
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw databaseFailure();
  if (!data)
    throw failure(404, "not_found", "That bank connection was not found.");
  const item = data as ItemRow;
  if (
    item.workspace_id !== actor.workspaceId ||
    item.linked_by !== actor.userId
  )
    throw failure(
      403,
      "forbidden",
      "Only the member who linked this bank can manage it.",
    );
  const allowedStatuses = allowDisconnected
    ? ["active", "error", "revoked"]
    : ["active", "error"];
  if (!allowedStatuses.includes(item.status))
    throw failure(
      409,
      "connection_unavailable",
      item.status === "pending"
        ? "Finish reviewing this bank connection before managing it."
        : "This bank connection is disconnected.",
    );
  return item;
}

function accessToken(item: ItemRow): string {
  try {
    return decryptAccessToken(
      parseBytea(item.access_token_ciphertext),
      getServerEnv().PLAID_TOKEN_ENCRYPTION_KEY,
    );
  } catch {
    throw databaseFailure();
  }
}

async function accountRows(itemId: string): Promise<AccountRow[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("accounts")
    .select(
      "id,provider_account_id,display_name,name,mask,subtype,scope,owner_profile_id,available_balance_cents,current_balance_cents,balance_updated_at,archived_at,lifecycle,read_only",
    )
    .eq("plaid_item_id", itemId)
    .order("created_at");
  if (error) throw databaseFailure();
  return (data ?? []) as AccountRow[];
}

async function connectionFor(
  actor: PlaidApiActor,
  item: ItemRow,
): Promise<PlaidConnection> {
  const admin = createSupabaseAdminClient();
  const [accounts, syncResult, profileResult] = await Promise.all([
    accountRows(item.id),
    admin
      .from("sync_state")
      .select("last_success_at,consent_expires_at,needs_login_repair,status")
      .eq("plaid_item_id", item.id)
      .maybeSingle(),
    admin.from("profiles").select("id,display_name"),
  ]);
  if (syncResult.error || profileResult.error) throw databaseFailure();
  const sync = syncResult.data as SyncRow | null;
  const names = new Map(
    (profileResult.data ?? []).map((p) => [
      p.id as string,
      p.display_name as string,
    ]),
  );
  const managed: ManagedPlaidAccount[] = accounts.map((account) => ({
    accountId: account.id,
    providerAccountId: account.provider_account_id,
    displayName: account.display_name ?? account.name,
    mask: account.mask,
    kind: account.subtype,
    scope: account.scope,
    ownerProfileId: account.owner_profile_id,
    ownerDisplayName: account.owner_profile_id
      ? (names.get(account.owner_profile_id) ?? null)
      : null,
    availableBalanceCents: account.available_balance_cents,
    currentBalanceCents: account.current_balance_cents,
    balanceUpdatedAt: account.balance_updated_at,
    lastSyncAt: sync?.last_success_at ?? null,
    lifecycle: account.lifecycle,
    readOnly: account.read_only,
    archivedAt: account.archived_at,
  }));
  const liveAccountCount = managed.filter(
    (account) => account.lifecycle === "live",
  ).length;
  const health =
    item.status === "revoked"
      ? "disconnected"
      : item.status === "error" ||
          sync?.needs_login_repair ||
          sync?.status === "failed"
        ? "attention"
        : "healthy";
  return {
    itemId: item.id,
    institutionName: item.institution_name,
    linkedBy: item.linked_by,
    isLinker: item.linked_by === actor.userId,
    status: item.status,
    health,
    lastSyncAt: sync?.last_success_at ?? null,
    consentExpiresAt: sync?.consent_expires_at ?? null,
    disconnectedAt: item.disconnected_at,
    itemImpact: {
      accountCount: managed.length,
      liveAccountCount,
      message:
        managed.length === 1
          ? "This action affects the account in this Item."
          : `This action can affect all ${managed.length} accounts sharing this bank connection.`,
    },
    accounts: managed,
  };
}

export async function getPlaidConnections(
  actor: PlaidApiActor,
): Promise<PlaidConnection[]> {
  const admin = createSupabaseAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("workspace_memberships")
    .select("id")
    .eq("workspace_id", actor.workspaceId)
    .eq("profile_id", actor.userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw databaseFailure();
  if (!membership)
    throw failure(403, "forbidden", "An active membership is required.");
  const { data, error } = await admin
    .from("plaid_items")
    .select(
      "id,workspace_id,linked_by,institution_name,access_token_ciphertext,status,archived_at,disconnected_at",
    )
    .eq("workspace_id", actor.workspaceId)
    .eq("linked_by", actor.userId)
    .in("status", ["active", "error", "revoked"])
    .order("created_at", { ascending: false });
  if (error) throw databaseFailure();
  return Promise.all(
    ((data ?? []) as ItemRow[]).map((item) => connectionFor(actor, item)),
  );
}

export async function changePlaidAccountVisibility(
  actor: PlaidApiActor,
  itemId: string,
  input: unknown,
) {
  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success)
    throw failure(
      400,
      "invalid_request",
      "Choose a visibility and acknowledge its retroactive impact.",
    );
  await loadOwnedItem(actor, itemId);
  const { error } = await createSupabaseAdminClient().rpc(
    "change_plaid_account_visibility",
    {
      p_item_id: itemId,
      p_account_id: parsed.data.accountId,
      p_workspace_id: actor.workspaceId,
      p_profile_id: actor.userId,
      p_scope: parsed.data.scope,
      p_acknowledge_retroactive_impact: true,
    },
  );
  if (error) throw parseRpcError(error);
  const item = await loadOwnedItem(actor, itemId);
  return {
    connection: await connectionFor(actor, item),
    recalculation: { dashboards: true as const, budgets: true as const },
  };
}

export async function createPlaidUpdateToken(
  actor: PlaidApiActor,
  itemId: string,
  input: unknown,
): Promise<{
  linkToken: string;
  expiration: string;
  affectedAccountIds: string[];
}> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success)
    throw failure(
      400,
      "invalid_request",
      "Choose a supported bank-repair reason.",
    );
  const item = await loadOwnedItem(actor, itemId);
  const accounts = await accountRows(itemId);
  const env = getServerEnv();
  try {
    const result = await getPlaidProvider().createUpdateLinkToken({
      userId: actor.userId,
      accessToken: accessToken(item),
      reason: parsed.data.reason as PlaidUpdateReason,
      webhookUrl: env.PLAID_WEBHOOK_URL,
      redirectUri: oauthRedirectUri(env.APP_URL),
    });
    return {
      ...result,
      affectedAccountIds: accounts.map((account) => account.id),
    };
  } catch (error) {
    if (error instanceof PlaidFlowError) throw error;
    throw providerFailure();
  }
}

function providerPayload(account: ProviderAccount) {
  const eligibility = reviewEligibility(account);
  const kind = toAccountKind(account);
  return {
    providerAccountId: account.accountId,
    name: account.name,
    officialName: account.officialName,
    mask: account.mask,
    type: account.type,
    kind,
    eligible: eligibility.eligible && kind !== null,
    availableBalanceCents: account.availableBalanceCents,
    currentBalanceCents: account.currentBalanceCents,
    creditLimitCents: account.creditLimitCents,
    balanceUpdatedAt: account.balanceUpdatedAt,
  };
}

export async function reconcilePlaidConnection(
  actor: PlaidApiActor,
  itemId: string,
  input: unknown,
) {
  const parsed = reconcileSchema.safeParse(input ?? {});
  if (!parsed.success)
    throw failure(
      400,
      "invalid_request",
      "The deselected-account request is invalid.",
    );
  const item = await loadOwnedItem(actor, itemId);
  let fresh: ProviderAccount[];
  try {
    fresh = await getPlaidProvider().getAccounts(accessToken(item));
  } catch {
    throw providerFailure();
  }
  const { data, error } = await createSupabaseAdminClient().rpc(
    "reconcile_plaid_accounts",
    {
      p_item_id: itemId,
      p_workspace_id: actor.workspaceId,
      p_profile_id: actor.userId,
      p_accounts: fresh.map(providerPayload),
      p_delete_ids: parsed.data.deleteDeselectedAccountIds ?? [],
    },
  );
  if (error) throw parseRpcError(error);
  const delta = (data ?? {}) as {
    addedAccountIds?: string[];
    returnedAccountIds?: string[];
  };
  const refreshed = await loadOwnedItem(actor, itemId);
  const connection = await connectionFor(actor, refreshed);
  return {
    connection,
    addedAccountIds: delta.addedAccountIds ?? [],
    returnedAccountIds: delta.returnedAccountIds ?? [],
    deselectedAccounts: connection.accounts.filter(
      (account) => account.lifecycle === "deselected",
    ),
  };
}

export async function disconnectPlaidConnection(
  actor: PlaidApiActor,
  itemId: string,
  input: unknown,
): Promise<{ itemId: string; mode: PlaidDisconnectMode; disconnected: true }> {
  const parsed = disconnectSchema.safeParse(input);
  if (!parsed.success)
    throw failure(
      400,
      "invalid_request",
      "Choose whether to keep history or delete local data.",
    );
  const item = await loadOwnedItem(actor, itemId, true);
  if (item.status === "revoked")
    return { itemId, mode: parsed.data.mode, disconnected: true };
  const admin = createSupabaseAdminClient();
  const { data: confirmation, error: confirmationError } = await admin
    .from("recent_auth_confirmations")
    .select("confirmed_at")
    .eq("profile_id", actor.userId)
    .gt("confirmed_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .maybeSingle();
  if (confirmationError) throw databaseFailure();
  if (!confirmation)
    throw failure(
      403,
      "recent_confirmation_required",
      "Confirm your password before disconnecting this bank.",
    );
  const claimId = randomUUID();
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_plaid_disconnect",
    {
      p_item_id: itemId,
      p_workspace_id: actor.workspaceId,
      p_profile_id: actor.userId,
      p_mode: parsed.data.mode,
      p_claim_id: claimId,
    },
  );
  if (claimError) {
    if (
      claimError.code === "55P03" ||
      claimError.message?.includes("in progress")
    )
      throw failure(
        409,
        "disconnect_in_progress",
        "This connection is already being disconnected.",
      );
    throw parseRpcError(claimError);
  }
  if (claim === "disconnected")
    return { itemId, mode: parsed.data.mode, disconnected: true };
  if (claim !== "provider_removed") {
    const { error: beginError } = await admin.rpc(
      "begin_plaid_disconnect_removal",
      { p_item_id: itemId, p_claim_id: claimId },
    );
    if (beginError) {
      // Safe rollback is possible only before the provider boundary begins.
      await admin.rpc("release_plaid_disconnect", {
        p_item_id: itemId,
        p_claim_id: claimId,
      });
      throw databaseFailure();
    }
    try {
      await getPlaidProvider().removeItem(accessToken(item));
    } catch {
      // The call may have reached Plaid. release_plaid_disconnect deliberately
      // cannot restore a removal_started claim; it remains error/stale so a
      // retry can safely repeat the idempotent provider removal.
      await admin.rpc("release_plaid_disconnect", {
        p_item_id: itemId,
        p_claim_id: claimId,
      });
      throw providerFailure();
    }
    const { error: removedError } = await admin.rpc(
      "mark_plaid_disconnect_provider_removed",
      { p_item_id: itemId, p_claim_id: claimId },
    );
    if (removedError) throw databaseFailure();
  }
  // An adopted provider_removed claim skips Plaid and resumes here.
  const { error } = await admin.rpc("finalize_claimed_plaid_disconnect", {
    p_item_id: itemId,
    p_workspace_id: actor.workspaceId,
    p_profile_id: actor.userId,
    p_mode: parsed.data.mode,
    p_claim_id: claimId,
  });
  if (error) throw databaseFailure();
  return { itemId, mode: parsed.data.mode, disconnected: true };
}
