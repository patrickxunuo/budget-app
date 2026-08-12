export type ManualEntryKind = "income" | "spending" | "refund";
export type Scope = "family" | "personal";

export type ManualEntryInput = {
  scope: Scope;
  kind: ManualEntryKind;
  amount: string;
  entryDate: string;
  description: string;
  categoryId: string;
  notes?: string | null;
};

export type ManualEntryUpdate = Partial<Omit<ManualEntryInput, "scope">>;

export type ManualEntry = {
  id: string;
  source: "manual";
  scope: Scope;
  ownerProfileId: string | null;
  kind: ManualEntryKind;
  amount: string;
  currencyCode: "CAD";
  entryDate: string;
  description: string;
  categoryId: string;
  categoryName?: string;
  notes: string | null;
  createdBy: string;
  lastEditedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
};

export type ManualEntryFilters = {
  scope?: Scope;
  from?: string;
  to?: string;
  categoryId?: string;
  accountId?: string;
  status?: "all" | "pending" | "posted";
  inclusion?: "default" | "included" | "excluded" | "transfers" | "all";
  search?: string;
  format?: "json" | "csv";
};
