import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logServerEvent } from "@/lib/security/log";

export type AuthDeletionReason =
  "account_deletion" | "workspace_deletion" | "orphaned_auth_identity";

type QueueRow = {
  auth_user_id: string;
  attempts: number;
};

async function recordFailure(row: QueueRow, message: string) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("auth_deletion_queue")
    .update({
      attempts: row.attempts + 1,
      last_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("auth_user_id", row.auth_user_id);
}

export async function enqueueAuthDeletion(
  userId: string,
  reason: AuthDeletionReason,
) {
  const { error } = await createSupabaseAdminClient()
    .from("auth_deletion_queue")
    .upsert(
      {
        auth_user_id: userId,
        reason,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "auth_user_id" },
    );
  if (error)
    logServerEvent("error", "Could not enqueue Auth identity deletion", {
      error,
    });
  return !error;
}

async function processRow(row: QueueRow) {
  const admin = createSupabaseAdminClient();
  const lookup = await admin.auth.admin.getUserById(row.auth_user_id);
  if (lookup.error && lookup.error.status !== 404) {
    await recordFailure(row, "Auth provider lookup failed");
    return false;
  }
  if (lookup.data.user) {
    const deletion = await admin.auth.admin.deleteUser(row.auth_user_id);
    if (deletion.error) {
      await recordFailure(row, "Auth provider deletion failed");
      return false;
    }
  }
  const cleared = await admin
    .from("auth_deletion_queue")
    .delete()
    .eq("auth_user_id", row.auth_user_id);
  if (cleared.error) {
    await recordFailure(row, "Deletion succeeded but queue cleanup failed");
    return false;
  }
  return true;
}

export async function deleteQueuedAuthUser(userId: string) {
  const { data, error } = await createSupabaseAdminClient()
    .from("auth_deletion_queue")
    .select("auth_user_id,attempts")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return processRow(data as QueueRow);
}

export async function processAuthDeletionQueue(limit = 25) {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const { data, error } = await createSupabaseAdminClient()
    .from("auth_deletion_queue")
    .select("auth_user_id,attempts")
    .order("requested_at", { ascending: true })
    .limit(safeLimit);
  if (error) throw error;
  let deleted = 0;
  let failed = 0;
  for (const row of (data ?? []) as QueueRow[]) {
    if (await processRow(row)) deleted += 1;
    else failed += 1;
  }
  return { processed: (data ?? []).length, deleted, failed };
}
