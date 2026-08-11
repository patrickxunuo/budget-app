import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ABSOLUTE_SESSION_SECONDS,
  SESSION_START_COOKIE,
  verifyState,
} from "./session-state";

export type ActiveMembership = {
  id: string;
  workspace_id: string;
  profile_id: string;
  role: "owner" | "member";
  status: "active";
};
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const store = await cookies();
  if (
    !verifyState(
      store.get(SESSION_START_COOKIE)?.value,
      user.id,
      "session",
      ABSOLUTE_SESSION_SECONDS,
    )
  )
    redirect("/sign-in?message=session-expired");
  return user;
}
export async function getActiveMembership(userId?: string) {
  const id = userId ?? (await requireUser()).id;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("workspace_memberships")
    .select("id,workspace_id,profile_id,role,status")
    .eq("profile_id", id)
    .eq("status", "active")
    .maybeSingle();
  return data as ActiveMembership | null;
}
export async function requireActiveMembership() {
  const user = await requireUser();
  const membership = await getActiveMembership(user.id);
  if (!membership) redirect("/sign-in");
  return { user, membership };
}
export async function workspaceExists() {
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("workspaces")
    .select("id", { count: "exact", head: true });
  return (count ?? 0) > 0;
}
