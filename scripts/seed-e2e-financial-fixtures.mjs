// Reconciles the deterministic financial rows used by real-backend dashboard
// browser journeys, against a LOCAL Supabase only.
//
// Run `pnpm seed:e2e` first so the owner, profile, and active workspace
// membership exist. This command deliberately owns financial rows only.

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TORONTO_TIME_ZONE = "America/Toronto";

const FIXTURE = Object.freeze({
  plaidItemId: "e2000000-0000-4000-8000-000000000035",
  availableAccountId: "e2000000-0000-4000-8000-000000000036",
  unavailableAccountId: "e2000000-0000-4000-8000-000000000037",
  categoryId: "e2000000-0000-4000-8000-000000000038",
  budgetId: "e2000000-0000-4000-8000-000000000039",
  transactionId: "e2000000-0000-4000-8000-000000000040",
  manualTransactionId: "e2000000-0000-4000-8000-000000000080",
  informationFirstTransactionIds: Array.from(
    { length: 21 },
    (_, index) =>
      `e2000000-0000-4000-8000-0000000000${String(41 + index).padStart(2, "0")}`,
  ),
  plaidItemProviderId: "e2e-gh35-dashboard-item",
  availableAccountProviderId: "e2e-gh35-family-chequing",
  unavailableAccountProviderId: "e2e-gh35-family-unavailable",
  transactionProviderId: "e2e-gh35-dashboard-spend",
  institutionId: "ins_e2e_gh35",
  institutionName: "E2E Fixture Bank",
  availableAccountName: "E2E Family Chequing",
  unavailableAccountName: "E2E Family Unavailable",
  categoryName: "E2E Dashboard Groceries",
  availableBalanceCents: 245_678,
  currentBalanceCents: 250_000,
  budgetTargetCents: 100_000,
  transactionAmount: 250,
});

function fail(message) {
  console.error(`[seed-e2e-financial-fixtures] ${message}`);
  process.exit(1);
}

function readEnv() {
  const values = new Map();
  try {
    const file = readFileSync(join(repoRoot, ".env.local"), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const trimmed = line.trim();
      const separator = trimmed.indexOf("=");
      if (!trimmed || trimmed.startsWith("#") || separator === -1) continue;
      values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
    }
  } catch {
    // A missing .env.local is fine when the values are already exported.
  }
  return (key) => process.env[key] ?? values.get(key);
}

function localTorontoDate(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function resultOrFail(operation, result) {
  if (result.error) fail(`${operation} failed: ${result.error.message}`);
  return result.data;
}

const env = readEnv();
const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
const email = (env("E2E_SEED_EMAIL") ?? "e2e-owner@budget.local").toLowerCase();
const password = env("E2E_SEED_PASSWORD");

if (!supabaseUrl || !serviceRoleKey) {
  fail(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.",
  );
}

let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  fail("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (!loopbackHosts.has(parsedUrl.hostname)) {
  fail(
    `refusing to seed a non-loopback Supabase project (${parsedUrl.hostname}). This script is for local and CI databases only.`,
  );
}
if (!password) {
  fail(
    "E2E_SEED_PASSWORD must be set to the disposable value used by pnpm seed:e2e. Keep it in the process environment or untracked .env.local; never commit it.",
  );
}

// Construct the privileged client only after the loopback guard. No hosted URL
// can cause an Auth or database request from this script.
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const users = resultOrFail(
  "listing Auth users",
  await admin.auth.admin.listUsers({ perPage: 200 }),
)?.users;
const user = users?.find(
  (candidate) => candidate.email?.toLowerCase() === email,
);
if (!user) {
  fail(`seeded Auth identity ${email} is absent; run \`pnpm seed:e2e\` first.`);
}

const profile = resultOrFail(
  "locating the seeded profile",
  await admin.from("profiles").select("id").eq("id", user.id).maybeSingle(),
);
if (!profile) {
  fail(`profile for ${email} is absent; run \`pnpm seed:e2e\` first.`);
}

const memberships = resultOrFail(
  "locating the active workspace membership",
  await admin
    .from("workspace_memberships")
    .select("workspace_id,profile_id,status")
    .eq("profile_id", user.id)
    .eq("status", "active")
    .limit(2),
);
if (memberships?.length !== 1) {
  fail(
    `expected exactly one active membership for ${email}; run \`pnpm seed:e2e\` first against a reset local database.`,
  );
}

const workspaceId = memberships[0].workspace_id;
const seededAt = new Date();
const transactionDate = localTorontoDate(seededAt);
const effectiveMonth = `${transactionDate.slice(0, 7)}-01`;

resultOrFail(
  "reconciling the fixture Plaid Item",
  await admin.from("plaid_items").upsert(
    {
      id: FIXTURE.plaidItemId,
      workspace_id: workspaceId,
      linked_by: user.id,
      plaid_item_id: FIXTURE.plaidItemProviderId,
      institution_id: FIXTURE.institutionId,
      institution_name: FIXTURE.institutionName,
      access_token_ciphertext: "\\x6532652d676833352d66697874757265",
      access_token_key_version: 1,
      // Dashboard reads join the live account rows directly. Keep this
      // fixture-only container pending so Plaid sync/status journeys cannot
      // select its deliberately non-decryptable placeholder token.
      status: "pending",
      archived_at: null,
      disconnected_at: null,
      disconnect_claim_id: null,
      disconnect_claimed_at: null,
      disconnect_claim_mode: null,
      disconnect_claim_previous_status: null,
      disconnect_claim_phase: null,
      disconnect_removal_started_at: null,
      disconnect_provider_removed_at: null,
    },
    { onConflict: "id" },
  ),
);

resultOrFail(
  "reconciling the fixture accounts",
  await admin.from("accounts").upsert(
    [
      {
        id: FIXTURE.availableAccountId,
        workspace_id: workspaceId,
        plaid_item_id: FIXTURE.plaidItemId,
        linked_by: user.id,
        provider_account_id: FIXTURE.availableAccountProviderId,
        type: "depository",
        subtype: "chequing",
        currency_code: "CAD",
        mask: "0035",
        name: FIXTURE.availableAccountName,
        display_name: FIXTURE.availableAccountName,
        scope: "family",
        owner_profile_id: null,
        available_balance_cents: FIXTURE.availableBalanceCents,
        current_balance_cents: FIXTURE.currentBalanceCents,
        credit_limit_cents: null,
        balance_updated_at: seededAt.toISOString(),
        lifecycle: "live",
        read_only: false,
        archived_at: null,
      },
      {
        id: FIXTURE.unavailableAccountId,
        workspace_id: workspaceId,
        plaid_item_id: FIXTURE.plaidItemId,
        linked_by: user.id,
        provider_account_id: FIXTURE.unavailableAccountProviderId,
        type: "depository",
        subtype: "savings",
        currency_code: "CAD",
        mask: "0135",
        name: FIXTURE.unavailableAccountName,
        display_name: FIXTURE.unavailableAccountName,
        scope: "family",
        owner_profile_id: null,
        available_balance_cents: null,
        current_balance_cents: null,
        credit_limit_cents: null,
        balance_updated_at: null,
        lifecycle: "live",
        read_only: false,
        archived_at: null,
      },
    ],
    { onConflict: "id" },
  ),
);

resultOrFail(
  "reconciling the fixture category",
  await admin.from("categories").upsert(
    {
      id: FIXTURE.categoryId,
      workspace_id: workspaceId,
      created_by: user.id,
      name: FIXTURE.categoryName,
      color: "#698B55",
      scope: "family",
      owner_profile_id: null,
      system_key: null,
      archived_at: null,
    },
    { onConflict: "id" },
  ),
);

resultOrFail(
  "reconciling the current-month fixture budget",
  await admin.from("budgets").upsert(
    {
      id: FIXTURE.budgetId,
      workspace_id: workspaceId,
      created_by: user.id,
      category_id: FIXTURE.categoryId,
      amount_cents: FIXTURE.budgetTargetCents,
      currency_code: "CAD",
      effective_month: effectiveMonth,
      end_month: null,
      scope: "family",
      owner_profile_id: null,
      archived_at: null,
    },
    { onConflict: "id" },
  ),
);

resultOrFail(
  "reconciling the current-month fixture transaction",
  await admin.from("transactions").upsert(
    {
      id: FIXTURE.transactionId,
      workspace_id: workspaceId,
      account_id: FIXTURE.availableAccountId,
      plaid_transaction_id: FIXTURE.transactionProviderId,
      amount: FIXTURE.transactionAmount,
      currency_code: "CAD",
      authorized_date: transactionDate,
      transaction_date: transactionDate,
      merchant_name: "E2E Grocer",
      name: "E2E Dashboard Grocery Purchase",
      pending: false,
      pending_transaction_id: null,
      removed_at: null,
      provider_payload: {
        stableMerchantId: "e2e-gh35-grocer",
        personalFinanceCategory: {
          primary: "FOOD_AND_DRINK",
          detailed: "FOOD_AND_DRINK_GROCERIES",
        },
        fixture: "GH-35",
      },
    },
    { onConflict: "id" },
  ),
);

resultOrFail(
  "reconciling the fixture transaction category",
  await admin.from("transaction_metadata").upsert(
    {
      transaction_id: FIXTURE.transactionId,
      workspace_id: workspaceId,
      updated_by: user.id,
      scope: "family",
      owner_profile_id: null,
      category_id: FIXTURE.categoryId,
      kind_override: null,
      merchant_rule_id: null,
      excluded: false,
      note: "GH-66 complete metadata fixture",
    },
    { onConflict: "transaction_id" },
  ),
);

const informationFirstMonth = transactionDate.slice(0, 7);
const informationFirstPendingDate = `${informationFirstMonth}-28`;
const informationFirstDates = Array.from(
  { length: 7 },
  (_, index) =>
    `${informationFirstMonth}-${String(index + 1).padStart(2, "0")}`,
);
const informationFirstTransactions = FIXTURE.informationFirstTransactionIds.map(
  (id, index) => ({
    id,
    workspace_id: workspaceId,
    account_id: FIXTURE.availableAccountId,
    plaid_transaction_id: `e2e-gh66-ledger-${String(index + 1).padStart(2, "0")}`,
    amount: 1 + index / 100,
    currency_code: "CAD",
    authorized_date:
      index === 0
        ? informationFirstPendingDate
        : informationFirstDates[index % informationFirstDates.length],
    transaction_date:
      index === 0
        ? informationFirstPendingDate
        : informationFirstDates[index % informationFirstDates.length],
    merchant_name: `GH-66 Ledger Merchant ${String(index + 1).padStart(2, "0")}`,
    name: `GH-66 deterministic excluded transaction ${String(index + 1).padStart(2, "0")}`,
    pending: index === 0,
    pending_transaction_id: null,
    removed_at: null,
    provider_payload: {
      stableMerchantId: `e2e-gh66-merchant-${index + 1}`,
      personalFinanceCategory: {
        primary: "GENERAL_MERCHANDISE",
        detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      },
      fixture: "GH-66",
    },
  }),
);

resultOrFail(
  "reconciling GH-66 information-first Plaid rows",
  await admin
    .from("transactions")
    .upsert(informationFirstTransactions, { onConflict: "id" }),
);

resultOrFail(
  "reconciling GH-66 exceptional transaction metadata",
  await admin.from("transaction_metadata").upsert(
    FIXTURE.informationFirstTransactionIds.map((transactionId, index) => ({
      transaction_id: transactionId,
      workspace_id: workspaceId,
      updated_by: user.id,
      scope: "family",
      owner_profile_id: null,
      category_id: FIXTURE.categoryId,
      kind_override: null,
      merchant_rule_id: null,
      excluded: true,
      note: index === 0 ? "Pending and excluded GH-66 fixture" : null,
    })),
    { onConflict: "transaction_id" },
  ),
);

resultOrFail(
  "reconciling GH-66 manual information-first row",
  await admin.from("manual_entries").upsert(
    {
      id: FIXTURE.manualTransactionId,
      workspace_id: workspaceId,
      created_by: user.id,
      last_edited_by: user.id,
      scope: "family",
      owner_profile_id: null,
      kind: "income",
      amount: 1,
      currency_code: "CAD",
      entry_date: transactionDate,
      description: "GH-66 Manual Cash Adjustment",
      category_id: FIXTURE.categoryId,
      notes: "Deterministic manual detail note",
      archived_at: null,
      deleted_at: null,
      deleted_by: null,
    },
    { onConflict: "id" },
  ),
);
const assignments = [
  `E2E_DASHBOARD_MEMBER_EMAIL=${email}`,
  `E2E_DASHBOARD_MEMBER_PASSWORD=${password}`,
];

if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `${assignments.join("\n")}\n`);
  console.log(
    "[seed-e2e-financial-fixtures] exported dashboard credentials to $GITHUB_ENV",
  );
} else {
  console.log("\nExport these to provision the dashboard fixture family:\n");
  for (const assignment of assignments) console.log(`  ${assignment}`);
}

console.log(
  `[seed-e2e-financial-fixtures] reconciled Family dashboard fixtures for ${transactionDate}: target CA$1,000.00, spent CA$250.00, remaining CA$750.00`,
);
