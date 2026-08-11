import "server-only";

import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

import { getServerEnv } from "@/lib/env/server";

let plaidClient: PlaidApi | undefined;

export function getPlaidClient(): PlaidApi {
  if (plaidClient) {
    return plaidClient;
  }

  const env = getServerEnv();
  const configuration = new Configuration({
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
        "PLAID-SECRET": env.PLAID_SECRET,
      },
    },
    basePath:
      PlaidEnvironments[env.PLAID_ENV === "sandbox" ? "sandbox" : "production"],
  });

  plaidClient = new PlaidApi(configuration);
  return plaidClient;
}
