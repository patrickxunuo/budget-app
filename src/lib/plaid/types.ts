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
  error?: { error_code?: string; request_id?: string };
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
