export type DashboardScope = "family" | "personal";
export type DashboardPeriod = "day" | "week" | "month" | "custom";
export type DashboardInclusion =
  "default" | "included" | "excluded" | "transfers" | "all";
export type DashboardTransaction = {
  id: string;
  source: "plaid" | "manual";
  scope: DashboardScope;
  accountId: string | null;
  accountName: string | null;
  merchantOrDescription: string;
  category: { id: string; name: string; color: string | null } | null;
  amountCents: number;
  date: string;
  pending: boolean;
  kind: "income" | "spending" | "transfer" | "refund";
  excluded: boolean;
};
export type DashboardReadModel = {
  scope: DashboardScope;
  period: DashboardPeriod;
  range: { startDate: string; endDate: string };
  timeZone: string;
  summary: {
    incomeCents: number;
    spendingCents: number;
    netFlowCents: number;
    pendingAmountCents: number;
    pendingCount: number;
    includedCount: number;
    excludedCount: number;
  };
  trend: Array<{ date: string; incomeCents: number; spendingCents: number }>;
  categories: Array<{
    id: string;
    name: string;
    color: string | null;
    spendingCents: number;
    budgetCents: number | null;
    progressPercent: number | null;
  }>;
  accounts: Array<{
    id: string;
    name: string;
    mask: string | null;
    subtype: "chequing" | "savings" | "credit_card";
    availableCents: number | null;
    currentCents: number | null;
    freshnessAt: string | null;
  }>;
  transactions: DashboardTransaction[];
  filterOptions: {
    accounts: Array<{ id: string; name: string }>;
    categories: Array<{ id: string; name: string }>;
  };
};
export type DashboardFilters = {
  scope: DashboardScope;
  period: DashboardPeriod;
  reference: string;
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  status: "all" | "pending" | "posted";
  inclusion: DashboardInclusion;
  search?: string;
  limit: number;
};
