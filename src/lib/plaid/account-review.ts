import type { ProviderAccount } from "./types";

export type SupportedAccountKind = "chequing" | "savings" | "credit_card";

export function toAccountKind(
  account: ProviderAccount,
): SupportedAccountKind | null {
  const subtype = account.subtype?.toLowerCase().replaceAll("_", " ");
  if (
    account.type === "depository" &&
    ["checking", "chequing"].includes(subtype ?? "")
  )
    return "chequing";
  if (account.type === "depository" && subtype === "savings") return "savings";
  if (account.type === "credit" && subtype === "credit card")
    return "credit_card";
  return null;
}

export function reviewEligibility(account: ProviderAccount): {
  eligible: boolean;
  message: string | null;
} {
  if (account.currencyCode !== "CAD") {
    return {
      eligible: false,
      message: "Only Canadian-dollar accounts can be connected right now.",
    };
  }
  if (!toAccountKind(account)) {
    return {
      eligible: false,
      message:
        "This account type is not supported. Choose a chequing, savings, or credit-card account.",
    };
  }
  return { eligible: true, message: null };
}

export function normalizeAccountIdentity(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
