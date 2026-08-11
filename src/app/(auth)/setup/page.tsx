import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm, Field } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { setupFamily } from "@/lib/auth/actions";
import { getCurrentUser, workspaceExists } from "@/lib/auth/dal";
import { idleAuthState } from "@/lib/auth/types";
export default async function SetupPage() {
  if (await workspaceExists())
    redirect((await getCurrentUser()) ? "/dashboard" : "/sign-in");
  return (
    <AuthShell
      eyebrow="First entry"
      title="Name the household."
      description="The first person opens the private ledger and becomes its owner. Everyone else arrives through an invitation."
    >
      <AuthForm
        action={setupFamily}
        initialState={idleAuthState}
        submitLabel="Create family workspace"
        submitTestId="setup-submit"
      >
        <Field label="Your name" name="displayName" autoComplete="name" />
        <Field label="Workspace name" name="workspaceName" />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
        />
      </AuthForm>
      <p className="text-muted mt-6 text-sm">
        Already invited?{" "}
        <Link
          className="text-brand font-semibold underline-offset-4 hover:underline"
          href="/sign-in"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
