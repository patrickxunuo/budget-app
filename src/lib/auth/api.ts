import "server-only";

import { cookies } from "next/headers";

import {
  ABSOLUTE_SESSION_SECONDS,
  SESSION_START_COOKIE,
  verifyState,
} from "@/lib/auth/session-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PlaidApiActor = {
  userId: string;
  workspaceId: string;
  membershipId: string;
};

export class ApiAuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    public readonly code: "unauthorized" | "inactive_membership",
    message: string,
  ) {
    super(message);
  }
}

export async function requirePlaidApiActor(): Promise<PlaidApiActor> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiAuthError(
      401,
      "unauthorized",
      "Sign in again to connect a bank.",
    );
  }

  const cookieStore = await cookies();
  if (
    !verifyState(
      cookieStore.get(SESSION_START_COOKIE)?.value,
      user.id,
      "session",
      ABSOLUTE_SESSION_SECONDS,
    )
  ) {
    throw new ApiAuthError(
      401,
      "unauthorized",
      "Your session expired. Sign in again.",
    );
  }

  const { data: membership } = await supabase
    .from("workspace_memberships")
    .select("id,workspace_id,status")
    .eq("profile_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) {
    throw new ApiAuthError(
      403,
      "inactive_membership",
      "An active family membership is required to connect accounts.",
    );
  }

  return {
    userId: user.id,
    workspaceId: membership.workspace_id as string,
    membershipId: membership.id as string,
  };
}
