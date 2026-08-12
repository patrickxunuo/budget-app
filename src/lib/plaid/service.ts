import "server-only";

import { z } from "zod";

import type { PlaidApiActor } from "@/lib/auth/api";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { byteaHex, encryptAccessToken } from "./crypto";
import {
  normalizeAccountIdentity,
  reviewEligibility,
  toAccountKind,
} from "./account-review";
import { PlaidFlowError, sanitizedPlaidFailure } from "./errors";
import { getPlaidProvider } from "./provider";
import { syncPlaidItem } from "./sync-service";
import type {
  AccountScope,
  PlaidInstitution,
  ProviderAccount,
  ReviewAccount,
} from "./types";

const exchangeSchema = z.object({
  publicToken: z.string().min(1).max(2048),
  institution: z.object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
  }),
});

const activateSchema = z.object({
  reviewId: z.string().uuid(),
  accounts: z
    .array(
      z.object({
        providerAccountId: z.string().min(1).max(200),
        scope: z.enum(["personal", "family"]),
        acceptDuplicate: z.boolean().optional(),
      }),
    )
    .min(1),
});

async function findDuplicate(
  workspaceId: string,
  institution: PlaidInstitution,
  account: ProviderAccount,
) {
  const kind = toAccountKind(account);
  if (!kind) return null;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("accounts")
    .select(
      "id,name,display_name,mask,type,subtype,plaid_items!inner(institution_id,institution_name,status)",
    )
    .eq("workspace_id", workspaceId)
    .eq("scope", "family")
    .is("archived_at", null)
    .eq("type", account.type)
    .eq("subtype", kind)
    .eq("plaid_items.status", "active");

  // A failed lookup cannot safely mean "no duplicate". Fail the exchange so
  // activation never proceeds from an incomplete preview.
  if (error) throw sanitizedPlaidFailure("exchange");

  const duplicate = (data ?? []).find((candidate) => {
    const item = Array.isArray(candidate.plaid_items)
      ? candidate.plaid_items[0]
      : candidate.plaid_items;
    const masksCouldMatch =
      account.mask === null ||
      candidate.mask === null ||
      candidate.mask === account.mask;
    return (
      item?.institution_id === institution.id &&
      masksCouldMatch &&
      normalizeAccountIdentity(candidate.name) ===
        normalizeAccountIdentity(account.name)
    );
  });
  if (!duplicate) return null;
  const item = Array.isArray(duplicate.plaid_items)
    ? duplicate.plaid_items[0]
    : duplicate.plaid_items;
  return {
    accountId: duplicate.id as string,
    displayName: (duplicate.display_name ?? duplicate.name) as string,
    institutionName: item?.institution_name as string,
    mask: duplicate.mask as string | null,
  };
}

export async function createLinkTokenForMember(actor: PlaidApiActor) {
  const env = getServerEnv();
  try {
    return await getPlaidProvider().createLinkToken({
      userId: actor.userId,
      webhookUrl: env.PLAID_WEBHOOK_URL,
      redirectUri: new URL("/accounts", env.APP_URL).toString(),
    });
  } catch {
    throw sanitizedPlaidFailure("link");
  }
}

export async function exchangePublicTokenForReview(
  actor: PlaidApiActor,
  input: unknown,
) {
  const parsed = exchangeSchema.safeParse(input);
  if (!parsed.success)
    throw new PlaidFlowError(
      400,
      "invalid_request",
      "Check the bank connection details and try again.",
    );
  const { publicToken } = parsed.data;
  const provider = getPlaidProvider();
  let exchanged: Awaited<ReturnType<typeof provider.exchangePublicToken>>;
  let institution: PlaidInstitution;
  let accounts: ProviderAccount[];
  try {
    exchanged = await provider.exchangePublicToken(publicToken);
    institution = await provider.getInstitution(exchanged.accessToken);
    accounts = await provider.getAccounts(exchanged.accessToken);
  } catch (error) {
    const code =
      (
        error as {
          response?: { data?: { error_code?: string } };
          code?: string;
        }
      ).response?.data?.error_code ?? (error as { code?: string }).code;
    if (code?.includes("INVALID") || code?.includes("EXPIRED")) {
      throw new PlaidFlowError(
        422,
        "invalid_public_token",
        "That bank connection expired. Start a new connection.",
      );
    }
    throw sanitizedPlaidFailure("exchange");
  }

  const admin = createSupabaseAdminClient();
  const env = getServerEnv();
  const encrypted = encryptAccessToken(
    exchanged.accessToken,
    env.PLAID_TOKEN_ENCRYPTION_KEY,
  );
  const { data: item, error: itemError } = await admin
    .from("plaid_items")
    .insert({
      workspace_id: actor.workspaceId,
      linked_by: actor.userId,
      plaid_item_id: exchanged.itemId,
      institution_id: institution.id,
      institution_name: institution.name,
      access_token_ciphertext: byteaHex(encrypted),
      access_token_key_version: 1,
      status: "pending",
    })
    .select("id")
    .single();

  if (itemError) {
    if (itemError.code === "23505")
      throw new PlaidFlowError(
        409,
        "item_already_linked",
        "This bank connection is already linked.",
      );
    throw sanitizedPlaidFailure("exchange");
  }

  const reviewAccounts: ReviewAccount[] = [];
  try {
    for (const account of accounts) {
      const state = reviewEligibility(account);
      reviewAccounts.push({
        providerAccountId: account.accountId,
        name: account.name,
        officialName: account.officialName,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        currencyCode: account.currencyCode,
        eligible: state.eligible,
        eligibilityMessage: state.message,
        defaultScope: "personal",
        duplicate: state.eligible
          ? await findDuplicate(actor.workspaceId, institution, account)
          : null,
      });
    }
  } catch {
    await admin.from("plaid_items").delete().eq("id", item.id);
    throw sanitizedPlaidFailure("exchange");
  }

  const { error: candidatesError } = await admin
    .from("plaid_pending_accounts")
    .insert(
      reviewAccounts.map((account) => ({
        review_id: item.id,
        plaid_item_id: item.id,
        workspace_id: actor.workspaceId,
        linked_by: actor.userId,
        provider_account_id: account.providerAccountId,
        name: account.name,
        official_name: account.officialName,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        currency_code: account.currencyCode,
        eligible: account.eligible,
        eligibility_message: account.eligibilityMessage,
        duplicate_account_id: account.duplicate?.accountId ?? null,
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      })),
    );
  if (candidatesError) {
    await admin.from("plaid_items").delete().eq("id", item.id);
    throw sanitizedPlaidFailure("exchange");
  }

  return { reviewId: item.id as string, institution, accounts: reviewAccounts };
}

export async function activatePlaidReview(
  actor: PlaidApiActor,
  input: unknown,
) {
  const parsed = activateSchema.safeParse(input);
  if (!parsed.success) {
    throw new PlaidFlowError(
      400,
      "invalid_selection",
      "Select at least one eligible account.",
      {
        accounts: parsed.error.issues.map((issue) => issue.message),
      },
    );
  }
  const ids = parsed.data.accounts.map((account) => account.providerAccountId);
  if (new Set(ids).size !== ids.length) {
    throw new PlaidFlowError(
      400,
      "duplicate_selection",
      "Each account can be selected only once.",
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: activation, error } = await admin.rpc("activate_plaid_review", {
    p_review_id: parsed.data.reviewId,
    p_workspace_id: actor.workspaceId,
    p_profile_id: actor.userId,
    p_accounts: parsed.data.accounts,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("review expired"))
      throw new PlaidFlowError(
        410,
        "review_expired",
        "This review expired. Reconnect your bank.",
      );
    if (message.includes("duplicate account"))
      throw new PlaidFlowError(
        409,
        "duplicate_account",
        "This looks like an existing Family account. Confirm the duplicate to continue.",
      );
    if (message.includes("forbidden"))
      throw new PlaidFlowError(
        403,
        "forbidden",
        "This review belongs to another member.",
      );
    throw new PlaidFlowError(
      422,
      "invalid_selection",
      "The selected accounts could not be activated.",
    );
  }

  const activationResult = activation as {
    itemId?: string;
    activatedAccountIds?: string[];
  } | null;
  const result = {
    itemId: activationResult?.itemId ?? parsed.data.reviewId,
    activatedAccountIds: activationResult?.activatedAccountIds ?? [],
  };
  let importedTransactions = 0;
  let importStatus: "complete" | "pending" = "complete";

  // Activation is already committed. Initial import now uses the same atomic
  // claim/page/commit path as every later update; failures become retry state.
  try {
    const sync = await syncPlaidItem(result.itemId, "activation", actor);
    importedTransactions = sync.added + sync.modified;
  } catch {
    importStatus = "pending";
  }

  return { ...result, importedTransactions, importStatus };
}

export type ActivationSelection = {
  providerAccountId: string;
  scope: AccountScope;
  acceptDuplicate?: boolean;
};
