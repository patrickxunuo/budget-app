import type { Category, EffectiveCategory } from "./types";
export type MerchantMatcher = {
  matchType: "merchant_id" | "normalized_name";
  matchValue: string;
};
export function normalizeMerchantName(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.length >= 2 && /[\p{L}\p{N}]/u.test(normalized)
    ? normalized
    : null;
}
export function normalizeMerchantMatcher(input: {
  stableMerchantId?: string | null;
  merchantName?: string | null;
  name?: string | null;
}): MerchantMatcher | null {
  const id = input.stableMerchantId;
  if (id && id.trim()) return { matchType: "merchant_id", matchValue: id };
  const value =
    normalizeMerchantName(input.merchantName) ||
    normalizeMerchantName(input.name);
  return value ? { matchType: "normalized_name", matchValue: value } : null;
}
export function resolveEffectiveCategory(input: {
  manual?: Category | null;
  rule?: Category | null;
  plaid?: Category | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
}): EffectiveCategory {
  const selected = input.manual ?? input.rule ?? input.plaid;
  if (!selected) return null;
  return {
    id: selected.id,
    name: selected.name,
    color: selected.color,
    source: input.manual ? "manual" : input.rule ? "rule" : "plaid",
    updatedBy: input.manual || input.rule ? (input.updatedBy ?? null) : null,
    updatedAt: input.manual || input.rule ? (input.updatedAt ?? null) : null,
  };
}
