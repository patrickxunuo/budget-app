import type { Metadata } from "next";
import { MembershipConsole } from "@/components/auth/membership-console";
import { requireActiveMembership } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "Household members" };
type MemberRow = {
  id: string;
  profile_id: string;
  role: string;
  profiles: { display_name: string } | { display_name: string }[] | null;
};
type InvitationRow = { id: string; email: string; expires_at: string };
export default async function MembersPage() {
  const { membership } = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();
  const [{ data: workspace }, { data: rows }, { data: invites }] =
    await Promise.all([
      supabase
        .from("workspaces")
        .select("name")
        .eq("id", membership.workspace_id)
        .single(),
      supabase
        .from("workspace_memberships")
        .select("id,profile_id,role,profiles(display_name)")
        .eq("workspace_id", membership.workspace_id)
        .eq("status", "active")
        .order("created_at"),
      membership.role === "owner"
        ? supabase
            .from("invitations")
            .select("id,email,expires_at")
            .eq("workspace_id", membership.workspace_id)
            .is("accepted_at", null)
            .is("revoked_at", null)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
  const members = ((rows ?? []) as unknown as MemberRow[]).map((row) => ({
    id: row.id,
    profile_id: row.profile_id,
    role: row.role,
    display_name: Array.isArray(row.profiles)
      ? (row.profiles[0]?.display_name ?? "Family member")
      : (row.profiles?.display_name ?? "Family member"),
  }));
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="px-5 py-10 sm:px-8 lg:px-12"
    >
      <div className="mx-auto max-w-5xl">
        <header className="border-line mb-10 border-b pb-8">
          <p className="font-utility text-brand text-[.68rem] font-semibold tracking-[.15em] uppercase">
            Settings / membership register
          </p>
          <h1 className="font-display text-ink mt-3 text-5xl font-semibold tracking-[-.06em] sm:text-6xl">
            The household roll.
          </h1>
          <p className="text-muted mt-4 max-w-2xl leading-7">
            Invite, transfer, or leave with a clear record of who can enter the
            family ledger.
          </p>
        </header>
        <MembershipConsole
          isOwner={membership.role === "owner"}
          members={members}
          invitations={(invites ?? []) as unknown as InvitationRow[]}
          workspaceName={workspace?.name ?? ""}
        />
      </div>
    </main>
  );
}
