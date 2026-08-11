import Link from "next/link";
import { AuthForm, Field } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { requestPasswordReset } from "@/lib/auth/actions";
import { idleAuthState } from "@/lib/auth/types";
export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Recovery"
      title="Find your way back."
      description="Enter your email. We always show the same response so family membership stays private."
    >
      <AuthForm
        action={requestPasswordReset}
        initialState={idleAuthState}
        submitLabel="Send recovery link"
        submitTestId="recovery-submit"
      >
        <Field label="Email" name="email" type="email" autoComplete="email" />
      </AuthForm>
      <Link
        className="text-brand mt-6 inline-block text-sm font-semibold"
        href="/sign-in"
      >
        Back to sign in
      </Link>
    </AuthShell>
  );
}
