import { notFound } from "next/navigation";
import { createHash } from "node:crypto";
import { AuthForm, Field } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { acceptInvitation } from "@/lib/auth/actions";
import { idleAuthState } from "@/lib/auth/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!token || token.length < 32) notFound();
  const hash = createHash("sha256").update(token).digest("hex");
  const admin = createSupabaseAdminClient();
  const { data: invite } = await admin
    .from("invitations")
    .select("email,expires_at,workspace_id")
    .eq("token_hash", hash)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  let workspace: string | undefined;
  if (invite) {
    const { data } = await admin
      .from("workspaces")
      .select("name")
      .eq("id", invite.workspace_id)
      .single();
    workspace = data?.name;
  }
  return (
    <AuthShell
      eyebrow="Family invitation"
      title={
        invite
          ? `Join ${workspace ?? "the household"}.`
          : "This link has closed."
      }
      description={
        invite
          ? `This invitation is reserved for ${invite.email}. Create your account to enter the shared ledger.`
          : "The invitation is invalid, expired, revoked, or already used. Ask the workspace owner for a new link."
      }
    >
      <div data-testid="invite-status" aria-live="polite">
        {invite ? (
          <AuthForm
            action={acceptInvitation}
            initialState={idleAuthState}
            submitLabel="Join the family ledger"
            submitTestId="invite-accept-submit"
          >
            <input type="hidden" name="token" value={token} />
            <Field label="Your name" name="displayName" autoComplete="name" />
            <Field
              label="Create password"
              name="password"
              type="password"
              autoComplete="new-password"
            />
          </AuthForm>
        ) : (
          <div className="border-alert/30 bg-alert/8 text-alert rounded-xl border p-5 text-sm leading-6">
            This invitation can no longer be accepted.
          </div>
        )}
      </div>
    </AuthShell>
  );
}
