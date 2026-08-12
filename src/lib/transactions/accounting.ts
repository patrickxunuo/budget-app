export type TransactionKind = "income" | "spending" | "transfer" | "refund";
export type TransactionSource = "plaid" | "manual";
export type AccountingPeriod = "day" | "week" | "month" | "custom";

export interface AccountingTransaction {
  id: string;
  source: TransactionSource;
  amountCents: number;
  currencyCode: string;
  date: string;
  pending?: boolean;
  providerTransactionId?: string;
  pendingTransactionId?: string | null;
  removed?: boolean;
  providerCategoryPrimary?: string | null;
  providerCategoryDetailed?: string | null;
  name?: string | null;
  kindOverride?: TransactionKind | null;
  excluded?: boolean;
  categoryId?: string | null;
}

export interface AccountingLine extends AccountingTransaction {
  cashFlowCents: number;
  kind: TransactionKind;
  inclusion: "included" | "transfer" | "excluded" | "superseded";
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface AccountingSummary {
  incomeCents: number;
  spendingCents: number;
  refundsCents: number;
  netFlowCents: number;
  transferCents: number;
  pendingCount: number;
  includedCount: number;
  excludedCount: number;
  categorySpendingCents: Record<string, number>;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// The product deliberately accepts Canadian accounting zones rather than any
// syntactically valid IANA zone. Legacy IANA aliases remain accepted because
// they can occur in existing workspace settings.
const CANADIAN_TIME_ZONES = new Set([
  "America/Atikokan",
  "America/Blanc-Sablon",
  "America/Cambridge_Bay",
  "America/Coral_Harbour",
  "America/Creston",
  "America/Dawson",
  "America/Dawson_Creek",
  "America/Edmonton",
  "America/Fort_Nelson",
  "America/Glace_Bay",
  "America/Goose_Bay",
  "America/Halifax",
  "America/Inuvik",
  "America/Iqaluit",
  "America/Moncton",
  "America/Montreal",
  "America/Nipigon",
  "America/Pangnirtung",
  "America/Rainy_River",
  "America/Rankin_Inlet",
  "America/Regina",
  "America/Resolute",
  "America/St_Johns",
  "America/Swift_Current",
  "America/Thunder_Bay",
  "America/Toronto",
  "America/Vancouver",
  "America/Whitehorse",
  "America/Winnipeg",
  "America/Yellowknife",
  "Canada/Atlantic",
  "Canada/Central",
  "Canada/Eastern",
  "Canada/Mountain",
  "Canada/Newfoundland",
  "Canada/Pacific",
  "Canada/Saskatchewan",
  "Canada/Yukon",
]);

function assertSafeCents(value: number, field = "amountCents"): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${field} must be a safe integer number of cents`);
  }
}

function checkedAdd(left: number, right: number, field: string): number {
  const result = left + right;
  assertSafeCents(result, field);
  return result;
}

function parseLocalDate(value: string, field = "date"): Date {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD local date`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD local date`);
  }
  return date;
}

function toLocalDateString(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assertCanadianTimeZone(timeZone: string): void {
  if (!CANADIAN_TIME_ZONES.has(timeZone)) {
    throw new RangeError(
      `timeZone must be a valid Canadian IANA timezone: ${timeZone}`,
    );
  }

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(0));
  } catch {
    throw new RangeError(
      `timeZone must be a valid Canadian IANA timezone: ${timeZone}`,
    );
  }
}

function categoryToken(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

const GENUINE_DEPOSIT_DETAILS = new Set([
  "TRANSFER_IN_DEPOSIT",
  "TRANSFER_IN_CASH_DEPOSIT",
  "TRANSFER_IN_CHECK_DEPOSIT",
  "TRANSFER_IN_CASH_AND_CHECK_DEPOSIT",
]);

const INCOME_DETAILS = new Set([
  "INCOME_INTEREST_EARNED",
  "INCOME_PAYROLL",
  "INCOME_SALARIES_AND_WAGES",
  "INCOME_SALARY",
  "INCOME_WAGES",
]);

const REFUND_DETAILS_BY_PRIMARY: Readonly<Record<string, ReadonlySet<string>>> =
  {
    BANK_FEES: new Set(["BANK_FEES_REFUND"]),
    GENERAL_MERCHANDISE: new Set([
      "GENERAL_MERCHANDISE_REFUND",
      "GENERAL_MERCHANDISE_REVERSAL",
    ]),
    INCOME: new Set(["INCOME_TAX_REFUND"]),
  };

function assertCad(transaction: AccountingTransaction): void {
  if (transaction.currencyCode.trim().toUpperCase() !== "CAD") {
    throw new RangeError(`transaction ${transaction.id} must use CAD`);
  }
}

export function normalizeCashFlowCents(
  transaction: AccountingTransaction,
): number {
  assertSafeCents(transaction.amountCents);
  const normalized =
    transaction.source === "plaid"
      ? -transaction.amountCents
      : transaction.amountCents;
  assertSafeCents(normalized, "cashFlowCents");
  return normalized;
}

export function classifyTransaction(
  transaction: AccountingTransaction,
): TransactionKind {
  const cashFlowCents = normalizeCashFlowCents(transaction);
  if (transaction.kindOverride) {
    return transaction.kindOverride;
  }

  if (transaction.source === "manual") {
    return cashFlowCents >= 0 ? "income" : "spending";
  }

  const primary = categoryToken(transaction.providerCategoryPrimary);
  const detailed = categoryToken(transaction.providerCategoryDetailed);

  const genuineDeposit =
    primary === "TRANSFER_IN" && GENUINE_DEPOSIT_DETAILS.has(detailed);

  // Transfers are resolved before refunds or income. A merchant-supplied name
  // must never turn movement between accounts into an included cash flow.
  if (
    !genuineDeposit &&
    (primary === "TRANSFER_IN" ||
      primary === "TRANSFER_OUT" ||
      detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")
  ) {
    return "transfer";
  }

  // Refunds and reversals require an exact provider primary/detail pair.
  // Transaction names are descriptive text and are not accounting metadata.
  if (REFUND_DETAILS_BY_PRIMARY[primary]?.has(detailed)) {
    return "refund";
  }

  // Only Plaid's explicit income details qualify. In particular, an interest
  // charge under BANK_FEES is spending, while a cash/check deposit recorded
  // under TRANSFER_IN is genuine income rather than an account transfer.
  if (
    genuineDeposit ||
    (primary === "INCOME" && INCOME_DETAILS.has(detailed))
  ) {
    return "income";
  }

  if (cashFlowCents > 0) {
    return "refund";
  }
  return "spending";
}

export function resolveAccountingLine(
  transaction: AccountingTransaction,
  supersededProviderIds: ReadonlySet<string> = new Set<string>(),
): AccountingLine {
  const cashFlowCents = normalizeCashFlowCents(transaction);
  const kind = classifyTransaction(transaction);
  const superseded =
    transaction.pending === true &&
    transaction.providerTransactionId !== undefined &&
    supersededProviderIds.has(transaction.providerTransactionId);

  let inclusion: AccountingLine["inclusion"];
  if (superseded) {
    inclusion = "superseded";
  } else if (transaction.removed || transaction.excluded) {
    inclusion = "excluded";
  } else if (kind === "transfer") {
    assertCad(transaction);
    inclusion = "transfer";
  } else {
    assertCad(transaction);
    inclusion = "included";
  }

  return { ...transaction, cashFlowCents, kind, inclusion };
}

export function reconcilePendingTransactions(
  transactions: readonly AccountingTransaction[],
): AccountingLine[] {
  const supersededProviderIds = new Set<string>();

  for (const transaction of transactions) {
    if (
      transaction.source === "plaid" &&
      transaction.pending !== true &&
      !transaction.removed &&
      transaction.pendingTransactionId
    ) {
      supersededProviderIds.add(transaction.pendingTransactionId);
    }
  }

  return transactions.map((transaction) =>
    resolveAccountingLine(transaction, supersededProviderIds),
  );
}

export function formatLocalDate(
  instant: Date | string | number,
  timeZone: string,
): string {
  assertCanadianTimeZone(timeZone);
  const date =
    instant instanceof Date ? new Date(instant.getTime()) : new Date(instant);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("instant must be a valid date or timestamp");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function getDateRange(
  period: AccountingPeriod,
  reference: Date | string | number,
  timeZone: string,
  customRange?: DateRange,
): DateRange {
  assertCanadianTimeZone(timeZone);

  if (period === "custom") {
    if (!customRange) {
      throw new RangeError("customRange is required for a custom period");
    }
    parseLocalDate(customRange.startDate, "customRange.startDate");
    parseLocalDate(customRange.endDate, "customRange.endDate");
    if (customRange.startDate > customRange.endDate) {
      throw new RangeError("customRange startDate must not be after endDate");
    }
    return { ...customRange };
  }

  if (period !== "day" && period !== "week" && period !== "month") {
    throw new RangeError(`unsupported accounting period: ${String(period)}`);
  }

  const referenceDate =
    typeof reference === "string" && LOCAL_DATE_PATTERN.test(reference)
      ? (parseLocalDate(reference, "reference"), reference)
      : formatLocalDate(reference, timeZone);
  const localDate = parseLocalDate(referenceDate, "reference");

  if (period === "day") {
    return { startDate: referenceDate, endDate: referenceDate };
  }

  if (period === "week") {
    const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
    const start = new Date(localDate);
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return {
      startDate: toLocalDateString(start),
      endDate: toLocalDateString(end),
    };
  }

  const start = new Date(
    Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, 0),
  );
  return {
    startDate: toLocalDateString(start),
    endDate: toLocalDateString(end),
  };
}

export function calculateSummary(
  transactions: readonly AccountingTransaction[],
  range?: DateRange,
): AccountingSummary {
  if (range) {
    parseLocalDate(range.startDate, "range.startDate");
    parseLocalDate(range.endDate, "range.endDate");
    if (range.startDate > range.endDate) {
      throw new RangeError("range startDate must not be after endDate");
    }
  }

  const summary: AccountingSummary = {
    incomeCents: 0,
    spendingCents: 0,
    refundsCents: 0,
    netFlowCents: 0,
    transferCents: 0,
    pendingCount: 0,
    includedCount: 0,
    excludedCount: 0,
    categorySpendingCents: {},
  };

  for (const line of reconcilePendingTransactions(transactions)) {
    parseLocalDate(line.date, `transaction ${line.id} date`);
    if (range && (line.date < range.startDate || line.date > range.endDate)) {
      continue;
    }

    if (line.inclusion === "excluded") {
      // Provider removals are tombstones, not user exclusions, and therefore
      // do not appear in any summary count.
      if (!line.removed) {
        summary.excludedCount += 1;
      }
      continue;
    }
    if (line.inclusion === "superseded") {
      continue;
    }

    if (line.pending) {
      summary.pendingCount += 1;
    }

    if (line.inclusion === "transfer") {
      summary.transferCents = checkedAdd(
        summary.transferCents,
        Math.abs(line.cashFlowCents),
        "transferCents",
      );
      continue;
    }

    summary.includedCount += 1;
    if (line.kind === "income") {
      summary.incomeCents = checkedAdd(
        summary.incomeCents,
        Math.abs(line.cashFlowCents),
        "incomeCents",
      );
    } else if (line.kind === "spending") {
      const spending = Math.abs(line.cashFlowCents);
      summary.spendingCents = checkedAdd(
        summary.spendingCents,
        spending,
        "spendingCents",
      );
      if (line.categoryId) {
        summary.categorySpendingCents[line.categoryId] = checkedAdd(
          summary.categorySpendingCents[line.categoryId] ?? 0,
          spending,
          `categorySpendingCents.${line.categoryId}`,
        );
      }
    } else if (line.kind === "refund") {
      const refund = Math.abs(line.cashFlowCents);
      summary.refundsCents = checkedAdd(
        summary.refundsCents,
        refund,
        "refundsCents",
      );
      summary.spendingCents = checkedAdd(
        summary.spendingCents,
        -refund,
        "spendingCents",
      );
      if (line.categoryId) {
        summary.categorySpendingCents[line.categoryId] = checkedAdd(
          summary.categorySpendingCents[line.categoryId] ?? 0,
          -refund,
          `categorySpendingCents.${line.categoryId}`,
        );
      }
    }
  }

  summary.netFlowCents = checkedAdd(
    summary.incomeCents,
    -summary.spendingCents,
    "netFlowCents",
  );
  return summary;
}
