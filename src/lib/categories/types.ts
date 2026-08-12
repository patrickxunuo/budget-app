export type Scope = "family" | "personal";
export type Category = {
  id: string;
  name: string;
  color: string | null;
  scope: Scope;
  ownerProfileId: string | null;
  systemKey: string | null;
  archivedAt: string | null;
  inUse: boolean;
};
export type EffectiveCategory = {
  id: string;
  name: string;
  color: string | null;
  source: "plaid" | "rule" | "manual";
  updatedBy: string | null;
  updatedAt: string | null;
} | null;
export type OriginalPlaidCategory = {
  primary: string;
  detailed: string;
} | null;
export type TransactionCategoryView = {
  id: string;
  scope: Scope;
  ownerProfileId: string | null;
  merchantName: string | null;
  name: string;
  amount: number;
  transactionDate: string;
  pending: boolean;
  originalPlaidCategory: OriginalPlaidCategory;
  effectiveCategory: EffectiveCategory;
  stableMerchantId: string | null;
  normalizedMerchant: string | null;
};
export type MerchantRule = {
  id: string;
  categoryId: string;
  scope: Scope;
  ownerProfileId: string | null;
  matchType: "merchant_id" | "normalized_name";
  matchValue: string;
  enabled: boolean;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
