import "server-only";

import { formatEnvError, serverEnvSchema, type ServerEnv } from "./schemas";

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = serverEnvSchema.safeParse({
    APP_URL: process.env.APP_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID,
    PLAID_ENV: process.env.PLAID_ENV,
    PLAID_SECRET: process.env.PLAID_SECRET,
    PLAID_TOKEN_ENCRYPTION_KEY: process.env.PLAID_TOKEN_ENCRYPTION_KEY,
    PLAID_WEBHOOK_URL: process.env.PLAID_WEBHOOK_URL,
    PLAID_E2E_PROVIDER: process.env.PLAID_E2E_PROVIDER,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SMTP_URL: process.env.SMTP_URL,
    SMTP_FROM: process.env.SMTP_FROM,
  });

  if (!parsed.success) {
    throw new Error(formatEnvError(parsed.error));
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
