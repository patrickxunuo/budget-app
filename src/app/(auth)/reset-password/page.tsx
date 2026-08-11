import { AuthForm, Field } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { resetPassword } from "@/lib/auth/actions";
import { idleAuthState } from "@/lib/auth/types";
export default function ResetPasswordPage() {
  return (
    <AuthShell
      eyebrow="New key"
      title="Reset your password."
      description="Choose a strong password. This recovery session is short-lived and can only be used once."
    >
      <AuthForm
        action={resetPassword}
        initialState={idleAuthState}
        submitLabel="Save new password"
        submitTestId="reset-submit"
      >
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
        />
        <Field
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
        />
      </AuthForm>
    </AuthShell>
  );
}
