import type { Metadata } from "next";
import { MembershipConsole } from "@/components/auth/membership-console";
import { requireActiveMembership } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "Family members" };
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
      className="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7 lg:px-12"
    >
      <div className="mx-auto max-w-5xl">
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
