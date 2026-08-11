import { z } from "zod";

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export const serverEnvSchema = clientEnvSchema.extend({
  APP_URL: z.string().url(),
  CRON_SECRET: z.string().min(32),
  PLAID_CLIENT_ID: z.string().min(1),
  PLAID_ENV: z.enum(["sandbox", "production"]),
  PLAID_SECRET: z.string().min(1),
  PLAID_TOKEN_ENCRYPTION_KEY: z.string().min(32),
  PLAID_WEBHOOK_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function formatEnvError(error: z.ZodError): string {
  const details = error.issues
    .map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    )
    .join("; ");

  return `Invalid environment configuration: ${details}`;
}
