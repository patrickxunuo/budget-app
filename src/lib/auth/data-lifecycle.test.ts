import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  queues: new Map<string, Array<{ data: unknown; error: unknown }>>(),
  rpc: vi.fn(),
  serverRpc: vi.fn(),
  adminRpc: vi.fn(),
  getUser: vi.fn(),
  listUsers: vi.fn(),
  mutations: [] as Array<{ table: string; method: string; payload: unknown }>,
  filters: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));
const plaid = vi.hoisted(() => ({ revokePlaidItemsForDeletion: vi.fn() }));
const mail = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
const env = vi.hoisted(() => ({
  SMTP_URL: undefined as string | undefined,
  SMTP_FROM: undefined as string | undefined,
}));

function builder(table: string) {
  const result = db.queues.get(table)?.shift() ?? { data: null, error: null };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gt", "in", "order"]) {
    query[method] = vi.fn((...args: unknown[]) => {
      db.filters.push({ table, method, args });
      return query;
    });
  }
  for (const method of ["insert", "upsert", "update"]) {
    query[method] = vi.fn((payload: unknown) => {
      db.mutations.push({ table, method, payload });
      return query;
    });
  }
  query.maybeSingle = vi.fn(async () => result);
  query.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: db.getUser },
    rpc: (...args: unknown[]) => {
      db.serverRpc(...args);
      return db.rpc(...args);
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => builder(table),
    rpc: (...args: unknown[]) => {
      db.adminRpc(...args);
      return db.rpc(...args);
    },
    auth: { admin: { listUsers: db.listUsers } },
  }),
}));
vi.mock("@/lib/plaid/service", () => plaid);
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => env }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: mail.createTransport,
  },
}));

import { deleteAccountData, deleteWorkspaceData } from "./data-lifecycle";

const userId = "10000000-0000-4000-8000-000000000001";
const memberId = "10000000-0000-4000-8000-000000000002";
const workspaceId = "20000000-0000-4000-8000-000000000001";
const itemId = "40000000-0000-4000-8000-000000000001";

function queue(table: string, data: unknown, error: unknown = null) {
  const values = db.queues.get(table) ?? [];
  values.push({ data, error });
  db.queues.set(table, values);
}
function queueActor(role: "owner" | "member", recent = true) {
  queue("workspace_memberships", {
    workspace_id: workspaceId,
    profile_id: userId,
    role,
    workspaces: { name: "Morgan Household" },
  });
  queue(
    "recent_auth_confirmations",
    recent ? { confirmed_at: "2026-08-13T12:00:00.000Z" } : null,
  );
}

function configureNotificationRpc(
  claimStates: Array<"claimed" | "sent" | "busy">,
  overrides: Partial<Record<string, { data: unknown; error: unknown }>> = {},
) {
  let claimIndex = 0;
  db.rpc.mockImplementation(async (name: string) => {
    const override = overrides[name];
    if (override) return override;
    if (name === "claim_workspace_deletion_notification")
      return { data: claimStates[claimIndex++] ?? "busy", error: null };
    return { data: null, error: null };
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  db.queues.clear();
  db.mutations.length = 0;
  db.filters.length = 0;
  env.SMTP_URL = undefined;
  env.SMTP_FROM = undefined;
  db.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  db.rpc.mockResolvedValue({ data: null, error: null });
  db.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
  plaid.revokePlaidItemsForDeletion.mockResolvedValue({
    confirmedItemIds: [itemId],
    unresolvedItemIds: [],
  });
  mail.createTransport.mockReturnValue({ sendMail: mail.sendMail });
  mail.sendMail.mockResolvedValue({ messageId: "test-message" });
});

describe("GH-12 account and workspace data lifecycle", () => {
  it("API-006 rejects account deletion without recent confirmation before provider or database mutation", async () => {
    queueActor("member", false);

    await expect(deleteAccountData()).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/confirm.*password/i),
    });
    expect(plaid.revokePlaidItemsForDeletion).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("API-006 requires an owner to transfer ownership or delete the workspace", async () => {
    queueActor("owner");

    await expect(deleteAccountData()).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(
        /transfer ownership|delete the workspace/i,
      ),
    });
    expect(plaid.revokePlaidItemsForDeletion).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("API-007 preserves retryability and returns only safe internal IDs when revocation is unresolved", async () => {
    queueActor("member");
    plaid.revokePlaidItemsForDeletion.mockResolvedValueOnce({
      confirmedItemIds: [],
      unresolvedItemIds: [itemId],
    });

    const result = await deleteAccountData();

    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/nothing was deleted.*retry/i),
      unresolvedPlaidItemIds: [itemId],
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /access[_-]?token|provider_payload|ciphertext/i,
    );
  });

  it("API-008 finalizes account deletion only after confirmed revocation and supports idempotent retry", async () => {
    queueActor("member");
    queueActor("member");

    await expect(deleteAccountData()).resolves.toEqual({ ok: true });
    await expect(deleteAccountData()).resolves.toEqual({ ok: true });

    expect(plaid.revokePlaidItemsForDeletion).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenNthCalledWith(1, "finalize_account_deletion");
    expect(db.rpc).toHaveBeenNthCalledWith(2, "finalize_account_deletion");
  });

  it("API-009 rejects a non-owner or mismatched workspace name before mail, provider, or deletion", async () => {
    queueActor("member");
    await expect(
      deleteWorkspaceData({ workspaceName: "Morgan Household" }),
    ).resolves.toMatchObject({ ok: false });

    queueActor("owner");
    await expect(
      deleteWorkspaceData({ workspaceName: "Wrong Household" }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/exactly/i),
    });

    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(plaid.revokePlaidItemsForDeletion).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("API-010 owner finalization permits active members, revokes first, and invokes the atomic workspace purge", async () => {
    queueActor("owner");
    queue("workspace_memberships", [
      { profile_id: userId },
      { profile_id: memberId },
    ]);

    await expect(
      deleteWorkspaceData({ workspaceName: " Morgan Household " }),
    ).resolves.toEqual({ ok: true });

    expect(plaid.revokePlaidItemsForDeletion).toHaveBeenCalledExactlyOnceWith(
      workspaceId,
    );
    expect(db.adminRpc).toHaveBeenCalledExactlyOnceWith(
      "finalize_workspace_deletion",
      {
        p_actor_id: userId,
        p_workspace_name: "Morgan Household",
        p_notifications_required: false,
      },
    );
    expect(db.serverRpc).not.toHaveBeenCalledWith(
      "finalize_workspace_deletion",
      expect.anything(),
    );
    expect(
      plaid.revokePlaidItemsForDeletion.mock.invocationCallOrder[0],
    ).toBeLessThan(db.adminRpc.mock.invocationCallOrder[0]!);
  });

  it("API-011 leaves the workspace intact when revocation or configured notification fails", async () => {
    queueActor("owner");
    queue("workspace_memberships", [{ profile_id: userId }]);
    plaid.revokePlaidItemsForDeletion.mockResolvedValueOnce({
      confirmedItemIds: [],
      unresolvedItemIds: [itemId],
    });
    await expect(
      deleteWorkspaceData({ workspaceName: "Morgan Household" }),
    ).resolves.toMatchObject({
      ok: false,
      unresolvedPlaidItemIds: [itemId],
    });
    expect(db.rpc).not.toHaveBeenCalled();

    queueActor("owner");
    queue("workspace_memberships", [{ profile_id: userId }]);
    env.SMTP_URL = "smtps://mailer.example.test:465";
    env.SMTP_FROM = "budget@example.test";
    configureNotificationRpc(["claimed"]);
    db.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: userId, email: "owner@example.test" }] },
      error: null,
    });
    mail.sendMail.mockRejectedValueOnce(new Error("SMTP unavailable"));
    await expect(
      deleteWorkspaceData({ workspaceName: "Morgan Household" }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(
        /notification.*nothing was deleted.*retry/i,
      ),
    });
    expect(plaid.revokePlaidItemsForDeletion).toHaveBeenCalledTimes(2);
    expect(
      db.rpc.mock.calls.some(
        ([name]) => name === "finalize_workspace_deletion",
      ),
    ).toBe(false);
  });

  it("API-012 skips mail when SMTP is absent and sends one pre-deletion warning per active member when configured", async () => {
    queueActor("owner");
    queue("workspace_memberships", [
      { profile_id: userId },
      { profile_id: memberId },
    ]);
    await deleteWorkspaceData({ workspaceName: "Morgan Household" });
    expect(mail.createTransport).not.toHaveBeenCalled();

    queueActor("owner");
    queue("workspace_memberships", [
      { profile_id: userId },
      { profile_id: memberId },
    ]);
    env.SMTP_URL = "smtps://mailer.example.test:465";
    env.SMTP_FROM = "Budget App <budget@example.test>";
    configureNotificationRpc(["claimed", "claimed"]);
    db.listUsers.mockResolvedValueOnce({
      data: {
        users: [
          { id: userId, email: "owner@example.test" },
          { id: memberId, email: "member@example.test" },
          { id: "unrelated", email: "other@example.test" },
        ],
      },
      error: null,
    });

    await expect(
      deleteWorkspaceData({ workspaceName: "Morgan Household" }),
    ).resolves.toEqual({ ok: true });

    expect(mail.createTransport).toHaveBeenCalledWith(env.SMTP_URL);
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
    expect(mail.sendMail.mock.calls.map(([message]) => message.to)).toEqual([
      "owner@example.test",
      "member@example.test",
    ]);
    expect(
      plaid.revokePlaidItemsForDeletion.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(mail.sendMail.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(mail.sendMail.mock.calls)).not.toContain(
      env.SMTP_URL,
    );
  });
});

describe("GH-12 claimed notification delivery", () => {
  function queueOwnerWithMembers(profileIds: string[]) {
    queueActor("owner");
    queue(
      "workspace_memberships",
      profileIds.map((profile_id) => ({ profile_id })),
    );
    env.SMTP_URL = "smtps://mailer.example.test:465";
    env.SMTP_FROM = "Budget App <budget@example.test>";
    db.listUsers.mockResolvedValueOnce({
      data: {
        users: profileIds.map((id) => ({
          id,
          email: id === userId ? "owner@example.test" : "member@example.test",
        })),
      },
      error: null,
    });
  }

  it("API-011 reports a concurrent busy claim as retryable without SMTP, mark-sent, release, or finalization", async () => {
    queueOwnerWithMembers([userId]);
    configureNotificationRpc(["busy"]);

    await expect(
      deleteWorkspaceData({ workspaceName: "Morgan Household" }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/notification.*retry/i),
    });

    expect(db.rpc).toHaveBeenCalledWith(
      "claim_workspace_deletion_notification",
      expect.objectContaining({
        p_workspace_id: workspaceId,
        p_profile_id: userId,
        p_claim_id: expect.any(String),
      }),
    );
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(
      db.rpc.mock.calls.some(
        ([name]) => name === "mark_workspace_deletion_notification_sent",
      ),
    ).toBe(false);
    expect(
      db.rpc.mock.calls.some(
        ([name]) => name === "release_workspace_deletion_notification",
      ),
    ).toBe(false);
    expect(
      db.rpc.mock.calls.some(
        ([name]) => name === "finalize_workspace_deletion",
      ),
    ).toBe(false);
  });

  it("API-012 skips an already-sent claim, sends only the newly claimed member, marks success, and requires notifications at finalization", async () => {
    queueOwnerWithMembers([userId, memberId]);
    db.rpc.mockImplementation(
      async (name: string, args: Record<string, string>) => {
        if (name === "claim_workspace_deletion_notification")
          return {
            data: args.p_profile_id === userId ? "sent" : "claimed",
            error: null,
          };
        return { data: null, error: null };
      },
    );

    await expect(
      deleteWorkspaceData({ workspaceName: "Morgan Household" }),
    ).resolves.toEqual({ ok: true });

    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(mail.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.test",
        messageId: expect.any(String),
      }),
    );
    const memberClaim = db.rpc.mock.calls.find(
      ([name, args]) =>
        name === "claim_workspace_deletion_notification" &&
        args.p_profile_id === memberId,
    );
    const claimId = memberClaim?.[1]?.p_claim_id;
    expect(db.rpc).toHaveBeenCalledWith(
      "mark_workspace_deletion_notification_sent",
      {
        p_workspace_id: workspaceId,
        p_profile_id: memberId,
        p_claim_id: claimId,
      },
    );
    expect(db.adminRpc).toHaveBeenCalledWith("finalize_workspace_deletion", {
      p_actor_id: userId,
      p_workspace_name: "Morgan Household",
      p_notifications_required: true,
    });
    expect(db.serverRpc).not.toHaveBeenCalledWith(
      "finalize_workspace_deletion",
      expect.anything(),
    );
  });

  it("API-011 releases only the definitely failed unsent claim and retries with the same deterministic Message-ID", async () => {
    queueOwnerWithMembers([memberId]);
    configureNotificationRpc(["claimed"]);
    mail.sendMail.mockRejectedValueOnce(new Error("definite SMTP rejection"));

    await expect(
      deleteWorkspaceData({ workspaceName: "Morgan Household" }),
    ).resolves.toMatchObject({ ok: false });

    const firstClaim = db.rpc.mock.calls.find(
      ([name]) => name === "claim_workspace_deletion_notification",
    );
    expect(db.rpc).toHaveBeenCalledWith(
      "release_workspace_deletion_notification",
      {
        p_workspace_id: workspaceId,
        p_profile_id: memberId,
        p_claim_id: firstClaim?.[1]?.p_claim_id,
      },
    );
    expect(
      db.rpc.mock.calls.some(
        ([name]) => name === "mark_workspace_deletion_notification_sent",
      ),
    ).toBe(false);
    const firstMessageId = mail.sendMail.mock.calls[0]?.[0]?.messageId;
    expect(firstMessageId).toEqual(expect.any(String));

    queueOwnerWithMembers([memberId]);
    configureNotificationRpc(["claimed"]);

    await expect(
      deleteWorkspaceData({ workspaceName: "Morgan Household" }),
    ).resolves.toEqual({ ok: true });

    const retryMessageId = mail.sendMail.mock.calls[1]?.[0]?.messageId;
    expect(retryMessageId).toBe(firstMessageId);
  });

  it("API-011 does not release after SMTP succeeds but mark-sent fails, avoiding an unsafe duplicate send", async () => {
    queueOwnerWithMembers([memberId]);
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_workspace_deletion_notification")
        return { data: "claimed", error: null };
      if (name === "mark_workspace_deletion_notification_sent")
        return {
          data: null,
          error: { code: "XX000", message: "ledger unavailable" },
        };
      return { data: null, error: null };
    });

    await expect(
      deleteWorkspaceData({ workspaceName: "Morgan Household" }),
    ).resolves.toMatchObject({ ok: false });

    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(
      db.rpc.mock.calls.some(
        ([name]) => name === "release_workspace_deletion_notification",
      ),
    ).toBe(false);
    expect(
      db.rpc.mock.calls.some(
        ([name]) => name === "finalize_workspace_deletion",
      ),
    ).toBe(false);
  });
});
