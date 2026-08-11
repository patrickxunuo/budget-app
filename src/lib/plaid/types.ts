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
  payload: Record<string, unknown>;
};
