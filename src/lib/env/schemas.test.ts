import { describe, expect, it } from "vitest";

import { clientEnvSchema, formatEnvError, serverEnvSchema } from "./schemas";

const validServerEnv = {
  APP_URL: "http://localhost:3000",
  CRON_SECRET: "c".repeat(32),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  PLAID_CLIENT_ID: "client-id",
  PLAID_ENV: "sandbox",
  PLAID_SECRET: "secret",
  PLAID_TOKEN_ENCRYPTION_KEY: "e".repeat(32),
  PLAID_WEBHOOK_URL: "https://example.com/api/plaid/webhook",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
} as const;

describe("environment schemas", () => {
  it("accepts the documented server configuration", () => {
    expect(serverEnvSchema.parse(validServerEnv)).toEqual(validServerEnv);
  });

  it("rejects server secrets that are too short", () => {
    const result = serverEnvSchema.safeParse({
      ...validServerEnv,
      CRON_SECRET: "short",
    });

    expect(result.success).toBe(false);
  });

  it("accepts only browser-safe client variables", () => {
    const result = clientEnvSchema.parse(validServerEnv);

    expect(result).toEqual({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    });
  });

  it("reports variable names without reporting secret values", () => {
    const result = serverEnvSchema.safeParse({
      ...validServerEnv,
      PLAID_SECRET: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = formatEnvError(result.error);
      expect(message).toContain("PLAID_SECRET");
      expect(message).not.toContain(validServerEnv.PLAID_SECRET);
    }
  });
});
