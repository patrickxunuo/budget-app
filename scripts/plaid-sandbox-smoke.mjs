// Exercises every live Plaid call the application makes, against Plaid Sandbox.
//
// The deterministic E2E provider cannot detect contract drift in request shapes,
// entitlements, or Item lifecycle behaviour, so this script talks to the real
// API. Run it after changing Plaid request construction, after rotating
// credentials, and as the manual smoke test before a Trial/Production release.
//
//   pnpm smoke:plaid
//
// Credentials come from the process environment, falling back to .env.local.
// The script creates a Sandbox Item and removes it again; it refuses to run
// outside Sandbox so it can never revoke a real member's connection.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const nodeRequire = createRequire(import.meta.url);
const { Configuration, PlaidApi, PlaidEnvironments, CountryCode, Products } =
  nodeRequire("plaid");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const env = readEnv();
const plaidEnv = env("PLAID_ENV");

if (plaidEnv !== "sandbox") {
  console.error(
    `Refusing to run: PLAID_ENV is "${plaidEnv ?? "unset"}". This script creates and removes Items and is Sandbox-only.`,
  );
  process.exit(1);
}

for (const key of [
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_WEBHOOK_URL",
  "APP_URL",
]) {
  if (!env(key)) {
    console.error(`Refusing to run: ${key} is not configured.`);
    process.exit(1);
  }
}

const client = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": env("PLAID_CLIENT_ID"),
        "PLAID-SECRET": env("PLAID_SECRET"),
      },
    },
  }),
);

const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

function describeError(error) {
  const data = error?.response?.data;
  return data?.error_code
    ? `${data.error_code}: ${data.error_message}`
    : (error?.message ?? String(error));
}

async function check(name, run) {
  try {
    record(name, true, await run());
    return true;
  } catch (error) {
    record(name, false, describeError(error));
    return false;
  }
}

// Mirrors oauthRedirectUri() in src/lib/plaid/service.ts.
function oauthRedirectUri(appUrl) {
  const redirectUri = new URL("/accounts", appUrl);
  return redirectUri.protocol === "https:" ? redirectUri.toString() : null;
}

// Mirrors stableClientUserId() in src/lib/plaid/provider.ts.
function stableClientUserId(userId) {
  return createHash("sha256").update(`budget-app:${userId}`).digest("hex");
}

const webhookUrl = env("PLAID_WEBHOOK_URL");
const clientUserId = stableClientUserId("plaid-sandbox-smoke");
const redirectUri = oauthRedirectUri(env("APP_URL"));

console.log(`APP_URL=${env("APP_URL")}`);
console.log(
  `redirect_uri: ${redirectUri ?? "(omitted — origin is not HTTPS)"}\n`,
);

// Mirrors PlaidSdkProvider.createLinkToken() in src/lib/plaid/provider.ts.
await check("linkTokenCreate (initial link)", async () => {
  const { data } = await client.linkTokenCreate({
    client_name: "Budget App",
    country_codes: [CountryCode.Ca],
    language: "en",
    products: [Products.Transactions],
    transactions: { days_requested: 365 },
    webhook: webhookUrl,
    user: { client_user_id: clientUserId },
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });
  return `expires ${data.expiration}`;
});

let institution;
await check("institutionsGet (CA + Transactions)", async () => {
  const { data } = await client.institutionsGet({
    count: 20,
    offset: 0,
    country_codes: [CountryCode.Ca],
    options: { products: [Products.Transactions] },
  });
  institution = data.institutions[0];
  return `${data.total} institutions, using ${institution?.name} (${institution?.institution_id})`;
});

let accessToken;
if (institution) {
  await check("sandbox Item create and exchange", async () => {
    const { data } = await client.sandboxPublicTokenCreate({
      institution_id: institution.institution_id,
      initial_products: [Products.Transactions],
      options: { webhook: webhookUrl },
    });
    const { data: exchanged } = await client.itemPublicTokenExchange({
      public_token: data.public_token,
    });
    accessToken = exchanged.access_token;
    return "Item created";
  });
}

if (accessToken) {
  // Mirrors PlaidSdkProvider.getInstitution().
  await check("getInstitution (itemGet + institutionsGetById)", async () => {
    const { data: item } = await client.itemGet({ access_token: accessToken });
    const institutionId = item.item.institution_id;
    const { data } = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Ca],
    });
    return `${data.institution.name}, consent expires ${item.item.consent_expiration_time ?? "never"}`;
  });

  // Mirrors PlaidSdkProvider.getAccounts().
  await check("accountsGet", async () => {
    const { data } = await client.accountsGet({ access_token: accessToken });
    const currencies = new Set(
      data.accounts.map((account) => account.balances.iso_currency_code),
    );
    return `${data.accounts.length} accounts, currencies ${[...currencies].join("/")}`;
  });

  // Mirrors PlaidSdkProvider.syncTransactions().
  await check("transactionsSync", async () => {
    let cursor;
    let added = 0;
    let pages = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { data } = await client.transactionsSync({
        access_token: accessToken,
        cursor,
      });
      pages += 1;
      added += data.added.length;
      cursor = data.next_cursor;
      if (data.has_more) continue;
      if (added > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return `${added} transactions over ${pages} pages`;
  });

  // Update mode and Item lifecycle, required by GH-11.
  await check("linkTokenCreate (update mode)", async () => {
    const { data } = await client.linkTokenCreate({
      client_name: "Budget App",
      country_codes: [CountryCode.Ca],
      language: "en",
      webhook: webhookUrl,
      user: { client_user_id: clientUserId },
      access_token: accessToken,
    });
    return `expires ${data.expiration}`;
  });

  await check("linkTokenCreate (update mode + account selection)", async () => {
    const { data } = await client.linkTokenCreate({
      client_name: "Budget App",
      country_codes: [CountryCode.Ca],
      language: "en",
      webhook: webhookUrl,
      user: { client_user_id: clientUserId },
      access_token: accessToken,
      update: { account_selection_enabled: true },
    });
    return `expires ${data.expiration}`;
  });

  await check(
    "sandboxItemResetLogin triggers ITEM_LOGIN_REQUIRED",
    async () => {
      await client.sandboxItemResetLogin({ access_token: accessToken });
      try {
        await client.accountsGet({ access_token: accessToken });
      } catch (error) {
        const code = error?.response?.data?.error_code;
        if (code === "ITEM_LOGIN_REQUIRED") return "repair state reached";
        throw error;
      }
      throw new Error("Item did not enter ITEM_LOGIN_REQUIRED");
    },
  );

  await check("itemRemove", async () => {
    await client.itemRemove({ access_token: accessToken });
    return "Item revoked";
  });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(
  `\n${checks.length - failed.length}/${checks.length} checks passed`,
);

if (failed.length > 0) {
  process.exit(1);
}
