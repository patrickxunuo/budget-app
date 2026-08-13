export type AccountScope = "personal" | "family";

export type ReviewDuplicate = {
  accountId: string;
  displayName: string;
  institutionName: string;
  mask: string | null;
};

export type ReviewAccount = {
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
  duplicate: ReviewDuplicate | null;
};

export type PlaidInstitution = { id: string; name: string };

export type ProviderAccount = {
  accountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currencyCode: string | null;
  availableBalanceCents?: number | null;
  currentBalanceCents?: number | null;
  creditLimitCents?: number | null;
  balanceUpdatedAt?: string;
};

export type ProviderTransaction = {
  transactionId: string;
  accountId: string;
  amount: number;
  currencyCode: string | null;
  authorizedDate: string | null;
  date: string;
  merchantName: string | null;
  name: string;
  pending: boolean;
  pendingTransactionId: string | null;
  payload: Record<string, unknown>;
  stableMerchantId?: string | null;
};

export type SyncTrigger = "activation" | "member" | "webhook" | "nightly";

export type SyncResult = {
  itemId: string;
  status: "succeeded" | "idle";
  added: number;
  modified: number;
  removed: number;
  requestId: string | null;
  lastSuccessAt: string | null;
};

export type SyncStatus = {
  itemId: string;
  institutionName: string;
  status: "idle" | "running" | "succeeded" | "failed";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
  errorCode: string | null;
  needsLoginRepair: boolean;
  consentExpiresAt: string | null;
};

export type PlaidWebhookPayload = {
  webhook_type: string;
  webhook_code: string;
  item_id?: string;
  error?: { error_code?: string; request_id?: string } | null;
  consent_expiration_time?: string | null;
};

export type PlaidVerificationKey = {
  alg: "ES256";
  crv: "P-256";
  expiredAt: number | null;
  kid: string;
  kty: "EC";
  use: "sig";
  x: string;
  y: string;
};

export type PlaidConnectionHealth = "healthy" | "attention" | "disconnected";
export type PlaidConnectionStatus = "pending" | "active" | "error" | "revoked";
export type PlaidAccountLifecycle = "live" | "deselected" | "disconnected";
export type PlaidUpdateReason =
  "login_repair" | "consent" | "permissions" | "account_selection";
export type PlaidDisconnectMode = "keep_history" | "delete_data";

export type ManagedPlaidAccount = {
  accountId: string;
  providerAccountId: string;
  displayName: string;
  mask: string | null;
  kind: "chequing" | "savings" | "credit_card";
  scope: AccountScope;
  ownerProfileId: string | null;
  ownerDisplayName: string | null;
  availableBalanceCents: number | null;
  currentBalanceCents: number | null;
  balanceUpdatedAt: string | null;
  lastSyncAt: string | null;
  lifecycle: PlaidAccountLifecycle;
  readOnly: boolean;
  archivedAt: string | null;
};

export type PlaidConnection = {
  itemId: string;
  institutionName: string;
  linkedBy: string;
  isLinker: boolean;
  status: PlaidConnectionStatus;
  health: PlaidConnectionHealth;
  lastSyncAt: string | null;
  consentExpiresAt: string | null;
  disconnectedAt: string | null;
  itemImpact: {
    accountCount: number;
    liveAccountCount: number;
    message: string;
  };
  accounts: ManagedPlaidAccount[];
};
