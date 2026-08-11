import { clientEnvSchema, formatEnvError } from "./schemas";

const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

if (!parsed.success) {
  throw new Error(formatEnvError(parsed.error));
}

export const clientEnv = parsed.data;
