import Link from "next/link";
import { AuthForm, Field } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { signIn } from "@/lib/auth/actions";
import { idleAuthState } from "@/lib/auth/types";
export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  return (
    <AuthShell
      eyebrow="Return to the ledger"
      title="Welcome home."
      description="Sign in to the family workspace. Membership is invitation-only and inactive memberships cannot enter."
    >
      <AuthForm
        action={signIn}
        initialState={idleAuthState}
        submitLabel="Open the ledger"
        submitTestId="sign-in-submit"
      >
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        {next && <input type="hidden" name="next" value={next} />}
      </AuthForm>
      <Link
        href="/forgot-password"
        className="text-brand mt-6 inline-block text-sm font-semibold underline-offset-4 hover:underline"
      >
        Forgot your password?
      </Link>
    </AuthShell>
  );
}
